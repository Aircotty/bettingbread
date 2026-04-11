const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../db/index');
const { isAuthenticated } = require('../middleware/auth');
const { tierSchema } = require('../schemas/base');
const { grantRole, revokeRole } = require('../services/discordBot');
const logger = require('../utils/logger');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

/**
 * Calculates the new expiry date based on the tier.
 * @param {string} tier - The membership tier.
 * @returns {Date|null} - The calculated expiry date or null for lifetime.
 */
function calculateExpiry(tier) {
  const now = new Date();
  if (tier === 'weekly') {
    now.setDate(now.getDate() + 7);
    return now;
  } else if (tier === 'monthly') {
    now.setMonth(now.getMonth() + 1);
    return now;
  }
  return null; // Lifetime or unknown
}

/**
 * Ensures we are using a Stripe Price ID.
 * If a Product ID (prod_...) is provided, it fetches its default price.
 * @param {string} idOrProductId - The ID from env.
 * @returns {Promise<string>} - The Price ID.
 */
async function ensurePriceId(idOrProductId) {
  if (idOrProductId.startsWith('price_')) return idOrProductId;
  
  if (idOrProductId.startsWith('prod_')) {
    logger.info('Resolving Product ID to Price ID', { product_id: idOrProductId });
    const product = await stripe.products.retrieve(idOrProductId);
    if (!product.default_price) {
      throw new Error(`Product ${idOrProductId} has no default price configured.`);
    }
    return typeof product.default_price === 'string' 
      ? product.default_price 
      : product.default_price.id;
  }
  
  return idOrProductId; // Fallback
}

/**
 * POST /api/payment/create-checkout
 * Creates a Stripe Checkout Session for a membership tier.
 */
router.post('/create-checkout', isAuthenticated, asyncHandler(async (req, res) => {
  const validation = tierSchema.safeParse(req.body.tier);
  if (!validation.success) {
    return res.status(400).json({ 
      error: 'Invalid membership tier', 
      details: validation.error.format() 
    });
  }
  
  const tier = validation.data;
  const { discord_id, email } = req.user;

  let priceId;
  if (tier === 'weekly') priceId = process.env.STRIPE_PRICE_WEEKLY;
  else if (tier === 'monthly') priceId = process.env.STRIPE_PRICE_PRO_MONTHLY;
  else if (tier === 'lifetime') priceId = process.env.STRIPE_PRICE_LIFETIME;

  if (!priceId) {
    logger.error('Missing Stripe Price ID in config', { tier });
    return res.status(500).json({ error: 'Payment service misconfigured.' });
  }

  // Resolve Price ID if it's a Product ID
  try {
    priceId = await ensurePriceId(priceId);
  } catch (err) {
    logger.error('Failed to resolve Price ID', { error: err.message, tier });
    return res.status(500).json({ error: 'Payment configuration error.' });
  }

  logger.info('Creating checkout session', { discord_id, tier, email });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: tier === 'lifetime' ? 'payment' : 'subscription',
      success_url: `${process.env.CLIENT_URL}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/dashboard`,
      customer_email: email,
      metadata: { discord_id, tier }
    });

    logger.info('Checkout session created', { 
      discord_id, 
      tier, 
      session_id: session.id,
      url: session.url 
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error('Stripe Checkout Session Creation Failed', { 
      error: err.message, 
      stack: err.stack,
      tier,
      price_id: priceId,
      user_id: discord_id,
      client_url: process.env.CLIENT_URL
    });
    // Re-throw to be caught by asyncHandler/errorHandler
    throw err;
  }

}));

/**
 * POST /api/payment/webhook (and also mounted at /api/stripe-webhook in app.js)
 * Handles Stripe events (payment success, subscription renewal, cancellation).
 * This endpoint is public and exempt from CSRF.
 */
/**
 * Stripe Webhook Handler
 * Handles Stripe events (payment success, subscription renewal, cancellation).
 * This handler is exported separately to allow mounting with express.raw() in app.js.
 */
const stripeWebhookHandler = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // Note: We use req.body directly because express.raw() is configured in app.js for this path
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn('Stripe Webhook signature verification failed', { error: err.message, ip: req.ip });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const { type, data } = event;
  logger.info(`Received Stripe Webhook: ${type}`, { event_id: event.id });

  try {
    switch (type) {
      case 'checkout.session.completed': {
        const session = data.object;
        const { discord_id, tier } = session.metadata;
        const customerId = session.customer;
        const subscriptionId = session.subscription || null;
        const expiry = calculateExpiry(tier);

        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // Update/Insert Membership
          await client.query(`
            INSERT INTO memberships (discord_id, tier, stripe_customer_id, stripe_subscription_id, expiry_date, status)
            VALUES ($1, $2, $3, $4, $5, 'active')
            ON CONFLICT (discord_id) DO UPDATE SET 
              tier = $2, 
              stripe_customer_id = $3, 
              stripe_subscription_id = $4, 
              expiry_date = $5,
              status = 'active',
              updated_at = now()
          `, [discord_id, tier, customerId, subscriptionId, expiry]);

          // Log Transaction
          await client.query(`
            INSERT INTO transactions (discord_id, stripe_session_id, amount_total, currency, tier, status)
            VALUES ($1, $2, $3, $4, $5, 'complete')
          `, [discord_id, session.id, session.amount_total, session.currency, tier]);

          // Log Audit Event
          await client.query(`
            INSERT INTO audit_logs (discord_id, event_type, tier, description)
            VALUES ($1, 'purchase', $2, 'User initial purchase completed via Stripe')
          `, [discord_id, tier]);

          await client.query('COMMIT');
          
          // Grant Discord Role
          await grantRole(discord_id);
          
          logger.info('Checkout session processed and role granted', { discord_id, tier, session_id: session.id });
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = data.object;
        // invoice.subscription will be present for recurring payments
        if (invoice.subscription) {
          const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
          const { discord_id, tier } = subscription.metadata;
          const expiry = calculateExpiry(tier);

          if (discord_id) {
            await pool.query('BEGIN');
            
            await pool.query(`
              UPDATE memberships 
              SET expiry_date = $1, status = 'active', updated_at = now() 
              WHERE stripe_subscription_id = $2
            `, [expiry, invoice.subscription]);

            await pool.query(`
              INSERT INTO audit_logs (discord_id, event_type, tier, description)
              VALUES ($1, 'purchase', $2, 'Subscription renewal successful')
            `, [discord_id, tier]);

            await pool.query('COMMIT');
            
            // Ensure they have the role
            await grantRole(discord_id);
            
            logger.info('Subscription renewal processed', { discord_id, subscription_id: invoice.subscription });
          }
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = data.object;
        logger.warn('Subscription payment failed', { 
          subscription_id: invoice.subscription, 
          customer_id: invoice.customer,
          amount: invoice.amount_due
        });
        
        // We log it but wait for customer.subscription.deleted to revoke access 
        // as per user approval (A/B testing automatic retries).
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = data.object;
        const { rows } = await pool.query(
          'SELECT discord_id, tier FROM memberships WHERE stripe_subscription_id = $1', 
          [subscription.id]
        );
        
        if (rows.length > 0) {
          const { discord_id, tier } = rows[0];
          
          await pool.query('BEGIN');
          await pool.query(`
            UPDATE memberships 
            SET status = 'cancelled', updated_at = now() 
            WHERE stripe_subscription_id = $1
          `, [subscription.id]);

          await pool.query(`
            INSERT INTO audit_logs (discord_id, event_type, tier, description)
            VALUES ($1, 'revoked', $2, 'Stripe subscription cancelled/deleted')
          `, [discord_id, tier]);
          await pool.query('COMMIT');
          
          // Revoke Discord Role
          await revokeRole(discord_id);
          
          logger.info('Subscription cancelled and role revoked', { discord_id, subscription_id: subscription.id });
        }
        break;
      }

      default:
        logger.info(`Unhandled Stripe Webhook Event Type: ${type}`);
    }
  } catch (err) {
    logger.error(`Error processing Stripe Webhook event: ${type}`, { 
      error: err.message, 
      stack: err.stack,
      event_id: event.id 
    });

    // If it's a transient error (DB connection, deadlock, Discord API timeout), 
    // return 500 to trigger Stripe's retry mechanism.
    const isTransient = err.isTransient || 
                        err.message.includes('connection') || 
                        err.message.includes('deadlock') ||
                        err.code === '40P01'; // Postgres deadlock code

    if (isTransient) {
       return res.status(500).json({ error: 'Temporary server error, please retry' });
    }
  }

  res.json({ received: true });
};

module.exports = { router, stripeWebhookHandler };

