/**
 * Warmup Engine
 *
 * Core logic that:
 * 1. Selects which campaigns need to send today
 * 2. Picks peer accounts to exchange warmup emails with
 * 3. Records results in the DB
 * 4. Checks inboxes for replies and spam-rescue
 */

const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { sendWarmupEmail, processInbox } = require('./emailService');

// Prevent concurrent warmup cycles running at the same time
let cycleRunning = false;
let inboxRunning = false;

/**
 * Run one warmup cycle. Called by the scheduler every 20min (or manually).
 * @param {boolean} force - skip time window check (for manual triggers)
 */
async function runWarmupCycle(force = false) {
  if (cycleRunning) {
    console.log('[Engine] Warmup cycle already running, skipping.');
    return;
  }
  cycleRunning = true;

  try {
    const today = new Date().toISOString().slice(0, 10);
    const currentHour = new Date().getHours();

    // Fetch all active campaigns
    const campaigns = db.prepare(`
      SELECT c.*, a.* ,
             c.id AS campaign_id, a.id AS account_id
      FROM campaigns c
      JOIN accounts a ON a.id = c.account_id
      WHERE c.status = 'active' AND a.active = 1
    `).all();

    for (const campaign of campaigns) {
      try {
        await processCampaign(campaign, today, currentHour, force);
      } catch (err) {
        console.error(`[Engine] Error processing campaign ${campaign.campaign_id}:`, err.message);
      }
    }
  } finally {
    cycleRunning = false;
  }
}

async function processCampaign(campaign, today, currentHour, force = false) {
  // Check send window (skip if manually triggered)
  if (!force && (currentHour < campaign.send_hour_start || currentHour >= campaign.send_hour_end)) {
    console.log(`[Engine] Campaign ${campaign.name}: outside send window (${campaign.send_hour_start}:00–${campaign.send_hour_end}:00), skipping.`);
    return;
  }

  // Reset daily counter if it's a new day
  if (campaign.last_run_date !== today) {
    // Advance warmup day and ramp up target
    const newTarget = Math.min(
      campaign.daily_target + campaign.ramp_increment,
      campaign.max_per_day
    );
    db.prepare(`
      UPDATE campaigns
      SET emails_sent_today = 0,
          current_day = current_day + 1,
          daily_target = ?,
          last_run_date = ?
      WHERE id = ?
    `).run(newTarget, today, campaign.campaign_id);

    campaign.emails_sent_today = 0;
    campaign.daily_target = newTarget;
    campaign.last_run_date = today;
    campaign.current_day = campaign.current_day + 1;
  }

  // Check if we've already hit today's target
  if (campaign.emails_sent_today >= campaign.daily_target) {
    return;
  }

  // Send exactly 1 email per cycle — natural pacing across the day
  const remaining = campaign.daily_target - campaign.emails_sent_today;
  const sendNow = Math.min(remaining, 1);

  // Get pool accounts (active pool/receiver accounts only)
  const pool = db.prepare(`
    SELECT * FROM accounts WHERE active = 1 AND role = 'pool'
  `).all();

  if (pool.length === 0) {
    console.warn(`[Engine] Campaign ${campaign.campaign_id}: no pool accounts available.`);
    return;
  }

  const fromAccount = {
    id: campaign.account_id,
    email: campaign.email,
    name: campaign.name,
    smtp_host: campaign.smtp_host,
    smtp_port: campaign.smtp_port,
    smtp_secure: campaign.smtp_secure,
    username: campaign.username,
    password: campaign.password,
  };

  let sentCount = 0;
  for (let i = 0; i < sendNow; i++) {
    const toAccount = pool[Math.floor(Math.random() * pool.length)];
    try {
      const { messageId, subject } = await sendWarmupEmail(fromAccount, toAccount);

      const emailId = uuidv4();
      db.prepare(`
        INSERT INTO warmup_emails (id, campaign_id, from_account_id, to_account_id, subject, message_id, sent_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(emailId, campaign.campaign_id, campaign.account_id, toAccount.id, subject, messageId);

      sentCount++;
      console.log(`[Engine] Sent warmup: ${fromAccount.email} → ${toAccount.email} (${subject})`);
    } catch (err) {
      console.error(`[Engine] Send failed ${fromAccount.email} → ${toAccount.email}:`, err.message);
    }
  }

  if (sentCount > 0) {
    db.prepare(`
      UPDATE campaigns SET emails_sent_today = emails_sent_today + ? WHERE id = ?
    `).run(sentCount, campaign.campaign_id);

    // Upsert daily stats
    db.prepare(`
      INSERT INTO daily_stats (campaign_id, date, sent) VALUES (?, ?, ?)
      ON CONFLICT(campaign_id, date) DO UPDATE SET sent = sent + excluded.sent
    `).run(campaign.campaign_id, today, sentCount);
  }
}

/**
 * Run inbox processing for all active accounts.
 * Finds warmup emails, replies, and rescues from spam.
 */
async function runInboxProcessing() {
  if (inboxRunning) {
    console.log('[Engine] Inbox processing already running, skipping.');
    return;
  }
  inboxRunning = true;
  const today = new Date().toISOString().slice(0, 10);
  try {
  // Process ALL active accounts — both pool (auto-reply) and sender (rescue from spam)
  const accounts = db.prepare('SELECT * FROM accounts WHERE active = 1').all();
  console.log(`[Engine] Processing inboxes for ${accounts.length} account(s)...`);

  for (const account of accounts) {
    try {
      const stats = await processInbox(account);

      if (stats.replied > 0 || stats.rescued > 0) {
        console.log(`[Engine] Inbox ${account.email}: replied=${stats.replied}, rescued=${stats.rescued}`);

        // Find campaigns targeting this account and update stats
        const campaigns = db.prepare(`
          SELECT DISTINCT campaign_id FROM warmup_emails
          WHERE to_account_id = ? AND replied = 0 AND sent_at >= date('now', '-7 days')
        `).all(account.id);

        for (const { campaign_id } of campaigns) {
          if (stats.replied > 0) {
            db.prepare(`
              UPDATE warmup_emails SET replied = 1, replied_at = datetime('now')
              WHERE to_account_id = ? AND campaign_id = ? AND replied = 0
              LIMIT ?
            `).run(account.id, campaign_id, stats.replied);

            db.prepare(`
              INSERT INTO daily_stats (campaign_id, date, replied) VALUES (?, ?, ?)
              ON CONFLICT(campaign_id, date) DO UPDATE SET replied = replied + excluded.replied
            `).run(campaign_id, today, stats.replied);
          }

          if (stats.rescued > 0) {
            db.prepare(`
              INSERT INTO daily_stats (campaign_id, date, rescued) VALUES (?, ?, ?)
              ON CONFLICT(campaign_id, date) DO UPDATE SET rescued = rescued + excluded.rescued
            `).run(campaign_id, today, stats.rescued);
          }
        }
      }
    } catch (err) {
      console.error(`[Engine] Inbox processing failed for ${account.email}:`, err.message);
    }
  }
  } finally {
    inboxRunning = false;
  }
}

module.exports = { runWarmupCycle, runInboxProcessing };
