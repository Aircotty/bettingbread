const express = require('express');
const { pool } = require('../db/index');
const { isAuthenticated } = require('../middleware/auth');
const { grantRole } = require('../services/discordBot');
const { z } = require('zod');


const router = express.Router();

router.get('/profile', isAuthenticated, async (req, res) => {
  try {
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

    res.json({
      user: { ...userRes.rows[0], isAdmin },
      membership: membershipRes.rows[0] || null,
      transactions: transactionsRes.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Activate 3-Day Free Trial
router.post('/trial', isAuthenticated, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.discord_id;
    
    await client.query('BEGIN');

    // 1. Check eligibility
    const { rows: profileRows } = await client.query('SELECT trial_used FROM profiles WHERE discord_id = $1', [userId]);
    const { rows: membershipRows } = await client.query('SELECT id FROM memberships WHERE discord_id = $1 AND status = $2', [userId, 'active']);

    if (profileRows[0]?.trial_used) {
      return res.status(400).json({ error: 'Trial already used' });
    }
    if (membershipRows.length > 0) {
      return res.status(400).json({ error: 'Active membership already exists' });
    }

    // 2. Create trial membership (configurable minutes)
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
    res.json({ message: 'Free trial activated', expiry_date: expiryDate });


  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Trial Activation Error:', err);
    res.status(500).json({ error: 'Failed to activate trial' });
  } finally {
    client.release();
  }
});

module.exports = router;