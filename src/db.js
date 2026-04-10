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
      role        TEXT NOT NULL DEFAULT 'pool', -- 'sender' = account being warmed | 'pool' = receiver/responder
      -- SMTP settings
      smtp_host   TEXT NOT NULL,
      smtp_port   INTEGER NOT NULL DEFAULT 465,
      smtp_secure INTEGER NOT NULL DEFAULT 1,
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
    'Lunch today?',
    'Quick one before standup',
    'Did you see that email from this morning?',
    'Are you heading to the meeting later?',
    'Reminded me of what you said last week',
    'Got a sec?',
    'How did that call go?',
    'Still on for Friday?',
    'You around this afternoon?',
    'Weird question but hear me out',
    'Meant to ask you this yesterday',
    'Did you manage to sort that out?',
    'How\'s the project coming along?',
    'Just left you a voicemail',
    'Coffee run — you want anything?',
    'Heads up on something',
    'Quick thing before EOD',
    'How was your weekend?',
    'You free for a quick call?',
    'Following up from yesterday',
    'Did the client get back to you?',
    'Something came up — can we chat?',
    'Just wanted to loop you in',
    'Totally forgot to mention this',
    'How are you finding the new setup?',
  ];

  const bodies = [
    `Hey,\n\nJust wanted to check in — how did that thing go yesterday? I kept meaning to ask but we kept missing each other.\n\nLet me know when you get a chance. No rush!\n\nCheers`,
    `Hi,\n\nHope your morning is going okay! Quick one — did you manage to get that sorted in the end? Been curious how it turned out.\n\nCatch you later,`,
    `Hey,\n\nRandom one but I was just thinking about what you mentioned last week and it actually made a lot of sense. Wanted to say I think you were right on that.\n\nAnyway, hope the rest of your day goes smoothly!\n\nSpeak soon`,
    `Hi,\n\nAre you heading to the 3pm? I might be a few minutes late but save me a seat if you can.\n\nAlso — did you see the update this morning? Worth a look when you get a moment.\n\nThanks`,
    `Hey,\n\nJust a quick note — I meant to loop you in on this earlier but the week got away from me.\n\nLet's find 10 minutes to catch up when you're free. Nothing urgent, just wanted to keep you in the loop.\n\nCheers`,
    `Hi,\n\nHope you're having a decent week so far! Mine's been pretty full-on but getting there.\n\nWanted to run something by you when you have a spare moment — nothing major, just wanted your take on it.\n\nSpeak soon`,
    `Hey,\n\nDid the client get back to you yet? I haven't heard anything on my end so just checking you're not in the same boat.\n\nLet me know how you get on!\n\nThanks`,
    `Hi,\n\nJust popping in to say hope your afternoon is going well! Feels like we haven't properly caught up in a while.\n\nGrab a coffee sometime this week?\n\nCheers`,
    `Hey,\n\nTotally forgot to mention this yesterday — but I came across something I think you'd find interesting. Will send it over properly when I'm back at my desk.\n\nHope the rest of your day is good!\n\nSpeak later`,
    `Hi,\n\nQuick heads up — I'll be on a call most of this afternoon so might be slow to reply. If it's urgent feel free to ping me directly.\n\nHope your day's going well!\n\nCheers`,
    `Hey,\n\nHow are you finding the new setup? Still getting used to it myself but starting to get the hang of it.\n\nLet me know if you figured out the shortcut for that thing — I keep doing it the long way!\n\nThanks`,
    `Hi,\n\nJust wanted to say good luck with that today — I know it's been a lot of back and forth but you've got this.\n\nLet me know how it goes!\n\nCheers`,
  ];

  const replies = [
    `Hey!\n\nThanks for the message — good to hear from you!\n\nYeah all good on my end, just been heads down lately. Will fill you in properly when I surface.\n\nSpeak soon`,
    `Hi,\n\nGood timing actually — I was just thinking about this!\n\nLet me get back to you on that properly later today. Just wrapping something up.\n\nCheers`,
    `Hey,\n\nThanks for looping me in! Appreciate it.\n\nI'll take a look and get back to you shortly. Hope the rest of your day is good!\n\nSpeak later`,
    `Hi,\n\nGood to hear from you! Yeah let's find a time to catch up — been too long.\n\nI'll drop you a calendar invite later if that works?\n\nCheers`,
    `Hey,\n\nThanks for the heads up — really helpful!\n\nWill get back to you on this once I've had a chance to look into it properly.\n\nSpeak soon`,
    `Hi,\n\nAppreciate you reaching out! Always good to hear from you.\n\nGive me until later today and I'll come back to you with more.\n\nThanks`,
    `Hey,\n\nGot your message — thanks!\n\nThings are good here, busy as always. Would be great to catch up properly soon.\n\nSpeak later`,
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
