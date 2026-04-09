const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');

// Rotating subject lines and body templates to keep emails looking natural
const SUBJECTS = [
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

const BODIES = [
  `Hi there,\n\nI hope this message finds you well. I wanted to reach out and see if we could catch up soon. It's been a while since we last connected.\n\nLooking forward to hearing from you!\n\nBest regards`,
  `Hello,\n\nJust checking in to see how things are going on your end. I've been meaning to get in touch for a while.\n\nWould love to hear your thoughts when you have a moment.\n\nWarm regards`,
  `Hi,\n\nI hope your week is off to a great start! I was thinking about our last conversation and wanted to follow up.\n\nLet me know if you have any questions or if there's anything I can help with.\n\nThanks`,
  `Hello,\n\nHope all is well with you. I wanted to reach out and share a quick update. Things have been busy on my end but I wanted to make sure we stay in touch.\n\nFeel free to reply whenever it's convenient for you.\n\nBest`,
  `Hi,\n\nJust a quick note to say hello and see how you're doing. I always enjoy our conversations and thought it was time to reconnect.\n\nHope to hear from you soon!\n\nKind regards`,
  `Hello,\n\nI hope you're having a fantastic day! I've been thinking about our recent discussions and wanted to follow up with a few thoughts.\n\nWould love to get your perspective on things when you have a chance.\n\nAll the best`,
  `Hi there,\n\nDrooping you a quick line to stay in touch. Things are going well on my end and I hope the same is true for you.\n\nLooking forward to our next conversation!\n\nWarmly`,
];

const REPLY_BODIES = [
  `Thanks for reaching out! Great to hear from you.\n\nI'll get back to you with more details soon.\n\nBest`,
  `Hi,\n\nThanks for your message! Always good to hear from you.\n\nLooking forward to staying in touch.\n\nBest regards`,
  `Hello,\n\nGreat to hear from you! Thanks for the update.\n\nWill be in touch soon.\n\nThanks`,
  `Hi there,\n\nThanks for reaching out. Really appreciate it!\n\nChat soon.\n\nBest`,
  `Hello,\n\nThanks for your note! Really appreciated hearing from you.\n\nTalk soon!\n\nWarm regards`,
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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
  const subject = pickRandom(SUBJECTS);
  const body = pickRandom(BODIES);

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
            const warmupHeader = msg.headers?.get('x-warmup');
            if (warmupHeader) {
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
        const warmupHeader = msg.headers?.get('x-warmup');
        if (warmupHeader) {
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
            text: pickRandom(REPLY_BODIES) + `\n\n${account.name}`,
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

/**
 * Test SMTP connection for an account. Returns { ok, error }.
 */
async function testSmtp(account) {
  try {
    const transporter = createTransporter(account);
    await transporter.verify();
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
  });
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { sendWarmupEmail, processInbox, testSmtp, testImap, pickRandom };
