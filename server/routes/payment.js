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
  else if (tier === 'pro_monthly') priceId = process.env.STRIPE_PRICE_PRO_MONTHLY;
  else if (tier === 'lifetime') priceId = process.env.STRIPE_PRICE_LIFETIME;

  logger.info('Creating checkout session', { discord_id, tier, email });

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
    session_id: session.id 
  });

  res.json({ url: session.url });
}));

/**
 * POST /api/payment/webhook
 * Handles Stripe events (payment success, subscription cancellation).
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn('Stripe Webhook signature verification failed', { error: err.message, ip: req.ip });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const { type, data } = event;
  logger.info(`Received Stripe Webhook: ${type}`, { event_id: event.id });

  if (type === 'checkout.session.completed') {
    const session = data.object;
    const { discord_id, tier } = session.metadata;
    const customerId = session.customer;
    const subscriptionId = session.subscription || null;

    // Calculate expiry
    let expiry = null;
    if (tier === 'weekly') {
      expiry = new Date();
      expiry.setDate(expiry.getDate() + 7);
    } else if (tier === 'pro_monthly') {
      expiry = new Date();
      expiry.setMonth(expiry.getMonth() + 1);
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Update Membership
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
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [discord_id, session.id, session.amount_total, session.currency, tier, 'complete']);

      // Log Audit Event
      await client.query(`
        INSERT INTO audit_logs (discord_id, event_type, tier, description)
        VALUES ($1, $2, $3, $4)
      `, [discord_id, 'purchase', tier, 'User purchased subscription via Stripe']);

      await client.query('COMMIT');

      // Grant Discord Role
      await grantRole(discord_id);

      logger.info('Payment processed successfully', { discord_id, tier, session_id: session.id });

    } catch (err) {
      await client.query('ROLLBACK');
      logger.error('Failed to process checkout.session.completed', { 
        error: err.message, 
        stack: err.stack, 
        discord_id, 
        tier 
      });
    } finally {
      client.release();
    }
  } else if (type === 'customer.subscription.deleted') {
    const subscription = data.object;
    
    try {
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
          VALUES ($1, $2, $3, $4)
        `, [discord_id, 'revoked', tier, 'Stripe subscription was cancelled/deleted']);
        
        await pool.query('COMMIT');
        
        // Revoke Discord Role
        await revokeRole(discord_id);
        
        logger.info('Subscription cancelled successfully', { 
          discord_id, 
          subscription_id: subscription.id 
        });
      }
    } catch (err) {
      await pool.query('ROLLBACK');
      logger.error('Failed to process customer.subscription.deleted', { 
        error: err.message, 
        stack: err.stack, 
        subscription_id: subscription.id 
      });
    }
  }

  res.json({ received: true });
});

module.exports = router;

