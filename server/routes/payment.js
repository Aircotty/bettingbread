const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../db/index');
const { isAuthenticated } = require('../middleware/auth');
const { grantRole, revokeRole } = require('../services/discordBot');
const { z } = require('zod');

const tierSchema = z.enum(['weekly', 'pro_monthly', 'lifetime']);

const router = express.Router();

// 1. Create Checkout Session
router.post('/create-checkout', isAuthenticated, async (req, res) => {
  const validation = tierSchema.safeParse(req.body.tier);
  if (!validation.success) {
    return res.status(400).json({ error: 'Invalid membership tier', details: validation.error.format() });
  }
  const tier = validation.data;
  const { discord_id, email } = req.user;

  let priceId;
  if (tier === 'weekly') priceId = process.env.STRIPE_PRICE_WEEKLY;
  else if (tier === 'pro_monthly') priceId = process.env.STRIPE_PRICE_PRO_MONTHLY;
  else if (tier === 'lifetime') priceId = process.env.STRIPE_PRICE_LIFETIME;


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

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe Error:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// 2. Stripe Webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
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

    try {
      await pool.query('BEGIN');

      // Update Membership
      await pool.query(`
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
      await pool.query(`
        INSERT INTO transactions (discord_id, stripe_session_id, amount_total, currency, tier, status)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [discord_id, session.id, session.amount_total, session.currency, tier, 'complete']);

      // Log Audit Event
      await pool.query(`
        INSERT INTO audit_logs (discord_id, event_type, tier, description)
        VALUES ($1, $2, $3, $4)
      `, [discord_id, 'purchase', tier, 'User purchased subscription']);

      await pool.query('COMMIT');

      // Trigger Discord Bot Role Granting
      const { grantRole } = require('../services/discordBot');
      await grantRole(discord_id);

      console.log(`Payment confirmed for ${discord_id}, Tier: ${tier}`);

    } catch (err) {
      await pool.query('ROLLBACK');
      console.error('Database Error in Webhook:', err);
    }
  } else if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    
    try {
      // Find the discord_id for this subscription
      const { rows } = await pool.query('SELECT discord_id FROM memberships WHERE stripe_subscription_id = $1', [subscription.id]);
      
      if (rows.length > 0) {
        const discordId = rows[0].discord_id;
        
        await pool.query('BEGIN');
        
        const updateRes = await pool.query(`
          UPDATE memberships 
          SET status = 'cancelled', updated_at = now() 
          WHERE stripe_subscription_id = $1
          RETURNING discord_id, tier
        `, [subscription.id]);

        if (updateRes.rows.length > 0) {
          const { discord_id, tier } = updateRes.rows[0];
          
          await pool.query(`
            INSERT INTO audit_logs (discord_id, event_type, tier, description)
            VALUES ($1, $2, $3, $4)
          `, [discord_id, 'revoked', tier, 'Stripe subscription was cancelled']);
          
          await revokeRole(discord_id);
        }
        
        await pool.query('COMMIT');
        
        console.log(`Subscription deleted: Revoked role for ${discordId}`);
      }
    } catch (err) {
      await pool.query('ROLLBACK');
      console.error('Database Error when handling subscription deletion:', err);
    }
  }

  res.json({ received: true });
});

module.exports = router;
