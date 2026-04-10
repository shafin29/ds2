const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const db = require('./db');

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getTemplates(type) {
  const rows = db.prepare('SELECT content FROM templates WHERE type = ? AND active = 1').all(type);
  return rows.map(r => r.content);
}

/**
 * Create a nodemailer transporter for an account.
 */
function createTransporter(account) {
  return nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: account.smtp_secure === 1,
    auth: {
      user: account.username,
      pass: account.password,
    },
    tls: { rejectUnauthorized: false },
  });
}

/**
 * Send a warmup email from one account to another.
 * Returns the Message-ID of the sent email.
 */
async function sendWarmupEmail(fromAccount, toAccount) {
  const transporter = createTransporter(fromAccount);
  const subject = pickRandom(getTemplates('subject'));
  const body = pickRandom(getTemplates('body'));

  const info = await transporter.sendMail({
    from: `"${fromAccount.name}" <${fromAccount.email}>`,
    to: `"${toAccount.name}" <${toAccount.email}>`,
    subject,
    text: body + `\n\n${fromAccount.name}`,
    headers: {
      'X-Warmup': '1',          // tag so we can identify warmup mail
      'X-Priority': '3',
    },
  });

  return { messageId: info.messageId, subject };
}

/**
 * Connect to an IMAP account, find unread warmup emails, reply + mark as not-spam.
 * Returns stats: { replied, rescued }
 */
async function processInbox(account) {
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: true,
    auth: {
      user: account.username,
      pass: account.password,
    },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  const stats = { replied: 0, rescued: 0, messageIds: [] };

  try {
    await client.connect();

    // ---- 1. Check Spam / Junk folder and rescue warmup emails ----
    const spamFolders = ['Spam', 'Junk', '[Gmail]/Spam', 'Junk E-mail'];
    for (const folder of spamFolders) {
      try {
        const lock = await client.getMailboxLock(folder);
        try {
          const uids = [];
          for await (const msg of client.fetch('1:*', { envelope: true, flags: true, headers: ['x-warmup'] })) {
            const headersStr = msg.headers?.toString('utf8') || '';
            if (headersStr.toLowerCase().includes('x-warmup:')) {
              uids.push(msg.uid);
            }
          }
          if (uids.length > 0) {
            // Move to Inbox and mark as not-spam
            await client.messageMove(uids, 'INBOX', { uid: true });
            stats.rescued += uids.length;
          }
        } finally {
          lock.release();
        }
      } catch {
        // Folder doesn't exist on this provider, skip
      }
    }

    // ---- 2. Find unread warmup emails in Inbox and reply ----
    const lock = await client.getMailboxLock('INBOX');
    try {
      const toReply = [];
      for await (const msg of client.fetch({ seen: false }, {
        envelope: true,
        flags: true,
        headers: ['x-warmup', 'message-id', 'from'],
        bodyStructure: true,
      })) {
        const headersStr = msg.headers?.toString('utf8') || '';
        if (headersStr.toLowerCase().includes('x-warmup:')) {
          toReply.push({
            uid: msg.uid,
            messageId: msg.envelope?.messageId,
            from: msg.envelope?.from?.[0],
            subject: msg.envelope?.subject,
          });
        }
      }

      for (const msg of toReply) {
        try {
          const replyTo = msg.from?.address;
          if (!replyTo) continue;

          // Send reply
          const transporter = createTransporter(account);
          await transporter.sendMail({
            from: `"${account.name}" <${account.email}>`,
            to: replyTo,
            subject: `Re: ${msg.subject || ''}`,
            text: pickRandom(getTemplates('reply')) + `\n\n${account.name}`,
            inReplyTo: msg.messageId,
            references: msg.messageId,
            headers: { 'X-Warmup': '1' },
          });

          // Mark original as read
          await client.messageFlagsAdd(msg.uid, ['\\Seen'], { uid: true });
          stats.replied++;
          stats.messageIds.push(msg.messageId);
        } catch (replyErr) {
          console.error(`[IMAP] Failed to reply to ${msg.messageId}:`, replyErr.message);
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    console.error(`[IMAP] Error processing inbox for ${account.email}:`, err.message);
  } finally {
    await client.logout().catch(() => {});
  }

  return stats;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/**
 * Test SMTP connection for an account. Returns { ok, error }.
 */
async function testSmtp(account) {
  try {
    const transporter = createTransporter(account);
    await withTimeout(transporter.verify(), 10000, 'SMTP');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Test IMAP connection for an account. Returns { ok, error }.
 */
async function testImap(account) {
  const client = new ImapFlow({
    host: account.imap_host,
    port: account.imap_port,
    secure: true,
    auth: { user: account.username, pass: account.password },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
  });
  try {
    await withTimeout(client.connect(), 10000, 'IMAP');
    await client.logout();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { sendWarmupEmail, processInbox, testSmtp, testImap, pickRandom };
