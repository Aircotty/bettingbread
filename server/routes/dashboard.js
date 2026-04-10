const express = require('express');
const { pool } = require('../db/index');
const { isAuthenticated } = require('../middleware/auth');
const { grantRole } = require('../services/discordBot');
const logger = require('../utils/logger');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

/**
 * GET /api/dashboard/profile
 * Retrieves user profile, membership status, and transaction history.
 */
router.get('/profile', isAuthenticated, asyncHandler(async (req, res) => {
  const userId = req.user.discord_id;
  
  // Execute all queries in parallel for better performance
  const [userRes, membershipRes, transactionsRes] = await Promise.all([
    pool.query(
      'SELECT discord_id, username, avatar, email, trial_used, created_at FROM profiles WHERE discord_id = $1', 
      [userId]
    ),
    pool.query(
      'SELECT id, tier, status, expiry_date FROM memberships WHERE discord_id = $1 AND status = $2 ORDER BY created_at DESC LIMIT 1',
      [userId, 'active']
    ),
    pool.query(
      'SELECT id, amount_total, currency, tier, status, created_at FROM transactions WHERE discord_id = $1 ORDER BY created_at DESC LIMIT 10',
      [userId]
    )
  ]);

  const adminIds = (process.env.ADMIN_DISCORD_IDS || '').split(',');
  const isAdmin = adminIds.includes(userId);

  logger.info('User fetched profile', { discord_id: userId, is_admin: isAdmin });

  res.json({
    user: { ...userRes.rows[0], isAdmin },
    membership: membershipRes.rows[0] || null,
    transactions: transactionsRes.rows
  });
}));

/**
 * POST /api/dashboard/trial
 * Activates a 3-Day Free Trial for eligible users.
 */
router.post('/trial', isAuthenticated, asyncHandler(async (req, res) => {
  const client = await pool.connect();
  const userId = req.user.discord_id;

  try {
    await client.query('BEGIN');

    // 1. Check eligibility
    const { rows: profileRows } = await client.query('SELECT trial_used FROM profiles WHERE discord_id = $1', [userId]);
    const { rows: membershipRows } = await client.query('SELECT id FROM memberships WHERE discord_id = $1 AND status = $2', [userId, 'active']);

    if (profileRows[0]?.trial_used) {
      logger.warn('User attempted to reuse free trial', { discord_id: userId });
      return res.status(400).json({ error: 'Trial already used' });
    }
    if (membershipRows.length > 0) {
      logger.warn('User attempted to activate trial while having active membership', { discord_id: userId });
      return res.status(400).json({ error: 'Active membership already exists' });
    }

    // 2. Create trial membership (configurable duration)
    const durationMinutes = parseInt(process.env.TRIAL_DURATION_MINUTES || '5', 10);
    const expiryDate = new Date();
    expiryDate.setMinutes(expiryDate.getMinutes() + durationMinutes);

    await client.query(`
      INSERT INTO memberships (discord_id, tier, status, expiry_date)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (discord_id) DO UPDATE SET
        tier = $2, status = $3, expiry_date = $4, updated_at = now()
    `, [userId, 'free_trial', 'active', expiryDate]);

    // 3. Mark trial as used
    await client.query('UPDATE profiles SET trial_used = TRUE WHERE discord_id = $1', [userId]);

    // 4. Grant Discord Role
    await grantRole(userId);

    // 5. Audit Log
    await client.query(`
      INSERT INTO audit_logs (discord_id, event_type, tier, description)
      VALUES ($1, $2, $3, $4)
    `, [userId, 'free_trial', 'free_trial', 'User activated a free trial']);

    await client.query('COMMIT');
    
    logger.info('Free trial successfully activated', { 
      discord_id: userId, 
      expiry_date: expiryDate 
    });
    
    res.json({ message: 'Free trial activated', expiry_date: expiryDate });

  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // Passed to global error handler
  } finally {
    client.release();
  }
}));

module.exports = router;
