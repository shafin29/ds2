const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'warmup.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initializeSchema() {
  db.exec(`
    -- Email accounts added to the warmup pool
    CREATE TABLE IF NOT EXISTS accounts (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      -- SMTP settings
      smtp_host   TEXT NOT NULL,
      smtp_port   INTEGER NOT NULL DEFAULT 587,
      smtp_secure INTEGER NOT NULL DEFAULT 0,
      -- IMAP settings
      imap_host   TEXT NOT NULL,
      imap_port   INTEGER NOT NULL DEFAULT 993,
      -- Shared credentials
      username    TEXT NOT NULL,
      password    TEXT NOT NULL,
      -- Status
      active      INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Warmup campaigns (one per account being warmed)
    CREATE TABLE IF NOT EXISTS campaigns (
      id              TEXT PRIMARY KEY,
      account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'active',  -- active | paused | completed
      -- Schedule config
      start_date      TEXT NOT NULL DEFAULT (date('now')),
      daily_target    INTEGER NOT NULL DEFAULT 5,      -- current day target (auto-incremented)
      max_per_day     INTEGER NOT NULL DEFAULT 50,     -- ceiling
      ramp_increment  INTEGER NOT NULL DEFAULT 5,      -- emails added each day
      -- Timing window (24h format)
      send_hour_start INTEGER NOT NULL DEFAULT 8,
      send_hour_end   INTEGER NOT NULL DEFAULT 18,
      -- Progress
      current_day     INTEGER NOT NULL DEFAULT 1,
      emails_sent_today INTEGER NOT NULL DEFAULT 0,
      last_run_date   TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Individual warmup emails sent/received
    CREATE TABLE IF NOT EXISTS warmup_emails (
      id              TEXT PRIMARY KEY,
      campaign_id     TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      from_account_id TEXT NOT NULL,
      to_account_id   TEXT NOT NULL,
      subject         TEXT NOT NULL,
      message_id      TEXT,        -- SMTP Message-ID header
      sent_at         TEXT,
      replied_at      TEXT,
      opened          INTEGER NOT NULL DEFAULT 0,
      replied         INTEGER NOT NULL DEFAULT 0,
      in_spam         INTEGER NOT NULL DEFAULT 0,
      rescued_from_spam INTEGER NOT NULL DEFAULT 0
    );

    -- Daily stats per campaign (aggregated for charts)
    CREATE TABLE IF NOT EXISTS daily_stats (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      sent        INTEGER NOT NULL DEFAULT 0,
      replied     INTEGER NOT NULL DEFAULT 0,
      spam        INTEGER NOT NULL DEFAULT 0,
      rescued     INTEGER NOT NULL DEFAULT 0,
      UNIQUE(campaign_id, date)
    );

    -- Email templates (subjects and bodies)
    CREATE TABLE IF NOT EXISTS templates (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL CHECK(type IN ('subject', 'body', 'reply')),
      content    TEXT NOT NULL,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function seedDefaultTemplates() {
  const count = db.prepare('SELECT COUNT(*) as c FROM templates').get().c;
  if (count > 0) return;

  const subjects = [
    'Quick question for you',
    'Following up on our conversation',
    'Checking in',
    'Wanted to share something with you',
    'Hope you\'re doing well',
    'Touching base',
    'Quick update',
    'Just wanted to say hi',
    'Thoughts on this?',
    'Any updates on your end?',
    'Looking forward to connecting',
    'Great talking the other day',
    'A quick note',
    'Circling back',
    'Dropping a line',
  ];

  const bodies = [
    `Hi there,\n\nI hope this message finds you well. I wanted to reach out and see if we could catch up soon. It's been a while since we last connected.\n\nLooking forward to hearing from you!\n\nBest regards`,
    `Hello,\n\nJust checking in to see how things are going on your end. I've been meaning to get in touch for a while.\n\nWould love to hear your thoughts when you have a moment.\n\nWarm regards`,
    `Hi,\n\nI hope your week is off to a great start! I was thinking about our last conversation and wanted to follow up.\n\nLet me know if you have any questions or if there's anything I can help with.\n\nThanks`,
    `Hello,\n\nHope all is well with you. I wanted to reach out and share a quick update. Things have been busy on my end but I wanted to make sure we stay in touch.\n\nFeel free to reply whenever it's convenient for you.\n\nBest`,
    `Hi,\n\nJust a quick note to say hello and see how you're doing. I always enjoy our conversations and thought it was time to reconnect.\n\nHope to hear from you soon!\n\nKind regards`,
  ];

  const replies = [
    `Thanks for reaching out! Great to hear from you.\n\nI'll get back to you with more details soon.\n\nBest`,
    `Hi,\n\nThanks for your message! Always good to hear from you.\n\nLooking forward to staying in touch.\n\nBest regards`,
    `Hello,\n\nGreat to hear from you! Thanks for the update.\n\nWill be in touch soon.\n\nThanks`,
    `Hi there,\n\nThanks for reaching out. Really appreciate it!\n\nChat soon.\n\nBest`,
    `Hello,\n\nThanks for your note! Really appreciated hearing from you.\n\nTalk soon!\n\nWarm regards`,
  ];

  const insert = db.prepare('INSERT INTO templates (type, content) VALUES (?, ?)');
  const insertMany = db.transaction(() => {
    subjects.forEach(s => insert.run('subject', s));
    bodies.forEach(b => insert.run('body', b));
    replies.forEach(r => insert.run('reply', r));
  });
  insertMany();
}

initializeSchema();
seedDefaultTemplates();

module.exports = db;
