const express = require('express');
const { pool } = require('../db/index');
const { isAuthenticated } = require('../middleware/auth');
const { revokeRole } = require('../services/discordBot');
const { discordIdSchema } = require('../schemas/base');
const logger = require('../utils/logger');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

/**
 * Middleware to check if user is admin.
 */
const isAdmin = (req, res, next) => {
  const adminIds = (process.env.ADMIN_DISCORD_IDS || '').split(',');
  if (req.user && adminIds.includes(req.user.discord_id)) {
    return next();
  }
  
  logger.warn('Unauthorized admin access attempt', {
    discord_id: req.user?.discord_id,
    path: req.originalUrl,
    ip: req.ip
  });
  
  return res.status(403).json({ error: 'Access denied - Admin only' });
};

/**
 * GET /api/admin/stats
 * Retrieves global platform statistics.
 */
router.get('/stats', isAuthenticated, isAdmin, asyncHandler(async (req, res) => {
  const [revenueRes, tiersRes, activityRes] = await Promise.all([
    pool.query('SELECT SUM(amount_total) as total FROM transactions WHERE status = $1', ['complete']),
    pool.query('SELECT tier, COUNT(*) as count FROM memberships WHERE status = $1 GROUP BY tier', ['active']),
    pool.query(`
      SELECT * FROM (
        SELECT 'signup' as event_type, p.username, NULL as tier, p.created_at 
        FROM profiles p
        UNION ALL
        SELECT a.event_type, p.username, a.tier, a.created_at 
        FROM audit_logs a
        JOIN profiles p ON a.discord_id = p.discord_id
      ) activity
      ORDER BY created_at DESC 
      LIMIT 15
    `)
  ]);

  logger.info('Admin retrieved stats', { admin_id: req.user.discord_id });

  res.json({
    revenue: (revenueRes.rows[0].total || 0) / 100,
    tiers: tiersRes.rows,
    activity: activityRes.rows
  });
}));

/**
 * GET /api/admin/members
 * Retrieves a list of all users and their membership status.
 */
router.get('/members', isAuthenticated, isAdmin, asyncHandler(async (req, res) => {
  const membersRes = await pool.query(`
    SELECT p.discord_id, p.username, p.avatar, m.tier, m.status, m.expiry_date
    FROM profiles p
    LEFT JOIN memberships m ON p.discord_id = m.discord_id
    ORDER BY p.created_at DESC
  `);
  
  logger.info('Admin retrieved member list', { 
    admin_id: req.user.discord_id,
    member_count: membersRes.rows.length 
  });
  
  res.json(membersRes.rows);
}));

/**
 * POST /api/admin/members/:discord_id/revoke
 * Manually revokes a user's active membership.
 */
router.post('/members/:discord_id/revoke', isAuthenticated, isAdmin, asyncHandler(async (req, res) => {
  const validation = discordIdSchema.safeParse(req.params.discord_id);
  if (!validation.success) {
    return res.status(400).json({ error: 'Invalid Discord ID format' });
  }
  const discord_id = validation.data;
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const updateRes = await client.query(`
      UPDATE memberships 
      SET status = 'cancelled', updated_at = NOW() 
      WHERE discord_id = $1 AND status = 'active'
      RETURNING tier
    `, [discord_id]);

    if (updateRes.rows.length === 0) {
      await client.query('ROLLBACK');
      logger.warn('Admin attempted to revoke non-existent/inactive membership', {
        admin_id: req.user.discord_id,
        target_id: discord_id
      });
      return res.status(404).json({ error: 'No active membership found for this user.' });
    }

    const { tier } = updateRes.rows[0];

    // Log to Audit table
    await client.query(`
      INSERT INTO audit_logs (discord_id, event_type, tier, description)
      VALUES ($1, $2, $3, $4)
    `, [discord_id, 'revoked', tier, `Admin (${req.user.discord_id}) manually revoked access`]);

    // Perform Discord Bot action
    await revokeRole(discord_id);
    
    await client.query('COMMIT');
    
    logger.info('Membership manually revoked by admin', { 
      discord_id, 
      admin_id: req.user.discord_id,
      tier 
    });
    
    res.json({ message: 'User membership successfully revoked.' });
    
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // Passed to global error handler via asyncHandler
  } finally {
    client.release();
  }
}));

module.exports = router;

