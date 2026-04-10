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
  if (count > 0) {
    // Replace all existing templates with the improved set
    db.prepare('DELETE FROM templates').run();
  }

  const subjects = [
    'Hey, been a while!',
    'Quick one',
    'Catching up',
    'How\'s everything going?',
    'Wanted to reach out',
    'Random thought',
    'Hope you\'re well',
    'Quick question',
    'Checking in on you',
    'Something I wanted to share',
    'Miss our chats',
    'How did things turn out?',
    'Thinking of you',
    'Any news on your end?',
    'Still thinking about what you said',
    'How\'s the family?',
    'Long time no speak',
    'Just saw something that reminded me of you',
    'Weekend plans?',
    'Quick update from my end',
    'Had a thought about our last chat',
    'You free to chat soon?',
    'Following up',
    'Wanted your opinion on something',
    'Hope things are going great',
  ];

  const bodies = [
    `Hey,\n\nHope things are going well on your end! Been meaning to reach out for a while now. Life's been pretty hectic but I finally found a moment to check in.\n\nHow's everything with you? Would love to catch up sometime soon.\n\nTake care`,
    `Hi,\n\nJust thinking about you and figured I'd drop a quick message. It's been too long since we properly caught up!\n\nHow have things been? Anything exciting happening on your end?\n\nCheers`,
    `Hey there,\n\nHope your week is treating you well! I had a quick thought and figured you'd be the right person to ask.\n\nWould love to get your perspective when you have a free moment. No rush at all!\n\nThanks`,
    `Hi,\n\nQuick note to say I've been thinking about our last conversation. Really stuck with me!\n\nHope everything's going smoothly for you. Let me know if you ever want to connect.\n\nBest`,
    `Hey,\n\nFinally getting around to sending this message I've been meaning to write for weeks!\n\nHope life is treating you well. Would be great to hear what you've been up to lately.\n\nWarm wishes`,
    `Hi there,\n\nJust saw something today that immediately made me think of you. Hope that's not too random!\n\nHow are things going? Would be great to catch up soon.\n\nAll the best`,
    `Hey,\n\nHope you're having a fantastic week so far! Just wanted to reach out and stay in touch.\n\nThings are good on my end — busy as always but can't complain.\n\nLet me know how you're doing when you get a chance!\n\nCheers`,
    `Hi,\n\nI know it's been a while since we last spoke, but I was thinking about you and wanted to check in.\n\nHope everything is going well. Would love to reconnect sometime soon!\n\nTake care`,
    `Hey,\n\nRandom midweek message — hope that's okay! Just wanted to see how you've been doing.\n\nLife's been pretty eventful on my end. Lots going on but all good things!\n\nHope we can catch up soon.\n\nBest`,
    `Hi,\n\nHope this finds you in good spirits! I've been meaning to get in touch for ages.\n\nWould love to hear what you've been up to. Feel free to reply whenever you get a moment.\n\nWarm regards`,
  ];

  const replies = [
    `Hey!\n\nSo great to hear from you! Thanks for reaching out — made my day.\n\nThings are going well here, keeping busy as usual. Would love to catch up properly soon!\n\nTalk soon`,
    `Hi,\n\nThanks for your message! Always a pleasure hearing from you.\n\nI'll get back to you with more details shortly. Hope you're having a great week!\n\nCheers`,
    `Hey,\n\nSo glad you reached out! I've been meaning to get in touch too.\n\nLet's definitely find a time to catch up. I'll reach out again soon!\n\nBest`,
    `Hi there,\n\nGreat to hear from you! Thanks for the message.\n\nThings are going really well on my end. Would love to hear more about what you've been up to!\n\nTake care`,
    `Hey!\n\nThanks for dropping a line — always good to hear from you.\n\nI'll be in touch soon with more. Hope all is well!\n\nWarm regards`,
    `Hi,\n\nReally appreciate you reaching out! It's been too long.\n\nLooking forward to catching up properly. I'll follow up soon!\n\nBest wishes`,
    `Hey,\n\nThanks so much for your message! Brought a smile to my face.\n\nWill definitely get back to you with more soon. Hope you're having a wonderful day!\n\nCheers`,
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
