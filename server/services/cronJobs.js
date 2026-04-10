const cron = require('node-cron');
const { pool } = require('../db/index');
const { revokeRole } = require('./discordBot');

const logger = require('../utils/logger');

/**
 * Initializes background tasks for membership maintenance.
 * Checks for expired memberships every minute and revokes Discord roles.
 */
function initCronJobs() {
  // Run every minute to accurately catch short trial expirations
  cron.schedule('* * * * *', async () => {
    try {
      // Find active memberships that have passed their expiry date
      const expiredRes = await pool.query(`
        SELECT discord_id, tier 
        FROM memberships 
        WHERE status = 'active' 
        AND expiry_date < NOW()
        AND tier != 'lifetime'
      `);

      if (expiredRes.rows.length === 0) {
        return;
      }

      logger.info(`Found ${expiredRes.rows.length} expired memberships to process`);

      for (const row of expiredRes.rows) {
        const { discord_id, tier } = row;
        
        logger.info('Processing membership expiry', { discord_id, tier });

        // 1. Revoke Discord Role
        await revokeRole(discord_id);

        // 2. Update Database status
        await pool.query(`
          UPDATE memberships 
          SET status = 'expired', updated_at = NOW() 
          WHERE discord_id = $1
        `, [discord_id]);

        // 3. Log Expiration Audit
        await pool.query(`
          INSERT INTO audit_logs (discord_id, event_type, tier, description)
          VALUES ($1, $2, $3, $4)
        `, [discord_id, 'expiration', tier, 'Membership time expired and role automatically revoked']);

        logger.info('Successfully expired membership and revoked role', { discord_id, tier });
      }
    } catch (err) {
      logger.error('Error in membership expiry cron job', { error: err.message, stack: err.stack });
    }
  });

  logger.info('Membership expiry cron job initialized');
}


module.exports = { initCronJobs };
