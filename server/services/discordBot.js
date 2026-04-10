const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const logger = require('../utils/logger');
const { pool } = require('../db/index');

// Define Role ID from env
const BREAD_BRO_ROLE_ID = process.env.DISCORD_ROLE_BREAD_BRO;

client.once('ready', () => {
  logger.info(`Discord Bot logged in as ${client.user.tag}`);
});

// Error handling to prevent crash if token is missing or intents are disallowed
if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_BOT_TOKEN !== 'your_bot_token_here') {
  client.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
    if (err.message.includes('intents')) {
       logger.error('Discord Bot Login Failed: Used disallowed intents. ACTION REQUIRED: Enable SERVER MEMBERS INTENT in Discord Developer Portal.');
    } else {
       logger.error('Discord Bot Login Failed', { error: err.message });
    }
  });
}

async function refreshDiscordToken(discordId) {
  const authRecord = await pool.query('SELECT refresh_token FROM discord_auth WHERE discord_id = $1', [discordId]);
  if (!authRecord.rows[0]) return null;

  try {
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: authRecord.rows[0].refresh_token
    });

    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    const { access_token, refresh_token, expires_in } = data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    await pool.query(`
      UPDATE discord_auth 
      SET access_token = $1, refresh_token = $2, expires_at = $3
      WHERE discord_id = $4
    `, [access_token, refresh_token, expiresAt, discordId]);

    return access_token;
  } catch (error) {
    logger.error('Failed to refresh Discord token', { error: error.message, discord_id: discordId });
    return null;
  }
}

async function addUserToGuild(discordId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return;

  const authRecordRes = await pool.query('SELECT access_token, expires_at FROM discord_auth WHERE discord_id = $1', [discordId]);
  if (!authRecordRes.rows[0]) return;
  
  let { access_token, expires_at } = authRecordRes.rows[0];

  if (new Date() >= new Date(expires_at)) {
    access_token = await refreshDiscordToken(discordId);
    if (!access_token) return;
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.members.add(discordId, { accessToken: access_token });
  } catch (error) {
    logger.error('Failed to add user to guild', { error: error.message, discord_id: discordId });
  }
}

/**
 * Grants the Bread Bro role to a Discord user and adds them to the server if needed.
 * @param {string} discordId - The user's Discord ID.
 */
async function grantRole(discordId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const roleId = process.env.DISCORD_ROLE_BREAD_BRO;

  if (!guildId || !roleId) {
    logger.error('Missing Discord Config for Role Grant', { guild_id: guildId, role_id: roleId });
    return;
  }

  // Ensure user is in guild
  await addUserToGuild(discordId);

  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) throw new Error('Target guild not found');

    const member = await guild.members.fetch(discordId);
    if (!member) throw new Error('Member not found in guild');

    await member.roles.add(roleId);
    logger.info('Discord role granted successfully', { discord_id: discordId, role_id: roleId, user_tag: member.user.tag });
    
  } catch (err) {
    logger.error('Failed to grant Discord role', { 
      error: err.message, 
      stack: err.stack,
      discord_id: discordId, 
      role_id: roleId 
    });
  }
}

/**
 * Revokes the Bread Bro role from a Discord user.
 * @param {string} discordId - The user's Discord ID.
 */
async function revokeRole(discordId) {
  const guildId = process.env.DISCORD_GUILD_ID;
  const roleId = BREAD_BRO_ROLE_ID;

  if (!guildId || !roleId) {
    logger.error('Missing Discord Config for Role Revoke', { guild_id: guildId, role_id: roleId });
    return;
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    if (!guild) throw new Error('Target guild not found');

    const member = await guild.members.fetch(discordId);
    if (!member) throw new Error('Member not found in guild');

    await member.roles.remove(roleId);
    logger.info('Discord role revoked successfully', { discord_id: discordId, role_id: roleId, user_tag: member.user.tag });
  } catch (err) {
    logger.error('Failed to revoke Discord role', { 
      error: err.message, 
      stack: err.stack,
      discord_id: discordId, 
      role_id: roleId 
    });
  }
}


module.exports = { grantRole, revokeRole };
