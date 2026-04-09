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
  `);
}

initializeSchema();

module.exports = db;
