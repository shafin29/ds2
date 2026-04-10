const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { testSmtp, testImap } = require('../emailService');

const router = express.Router();

// GET /api/accounts — list all accounts
router.get('/', (req, res) => {
  const accounts = db.prepare(`
    SELECT id, email, name, role, smtp_host, smtp_port, smtp_secure,
           imap_host, imap_port, username, active, created_at
    FROM accounts ORDER BY created_at DESC
  `).all();
  res.json(accounts);
});

// POST /api/accounts — add a new account
router.post('/', async (req, res) => {
  const {
    email, name, role = 'pool',
    smtp_host, smtp_port = 465, smtp_secure = true,
    imap_host, imap_port = 993,
    username, password,
  } = req.body;

  if (!email || !name || !smtp_host || !imap_host || !username || !password) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  if (!['sender', 'pool'].includes(role)) {
    return res.status(400).json({ error: 'role must be sender or pool.' });
  }

  const id = uuidv4();
  try {
    db.prepare(`
      INSERT INTO accounts (id, email, name, role, smtp_host, smtp_port, smtp_secure,
                            imap_host, imap_port, username, password)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, email, name, role, smtp_host, smtp_port, smtp_secure ? 1 : 0,
           imap_host, imap_port, username, password);

    const account = db.prepare('SELECT id, email, name, role, active, created_at FROM accounts WHERE id = ?').get(id);
    res.status(201).json(account);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Account with this email already exists.' });
    }
    throw err;
  }
});

// PATCH /api/accounts/:id — update active status or credentials
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!account) return res.status(404).json({ error: 'Account not found.' });

  const fields = ['name', 'role', 'smtp_host', 'smtp_port', 'smtp_secure', 'imap_host', 'imap_port', 'username', 'password', 'active'];
  const updates = [];
  const values = [];

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      values.push(req.body[field]);
    }
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update.' });

  values.push(id);
  db.prepare(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const updated = db.prepare('SELECT id, email, name, smtp_host, imap_host, active FROM accounts WHERE id = ?').get(id);
  res.json(updated);
});

// DELETE /api/accounts/:id
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Account not found.' });
  res.json({ ok: true });
});

// POST /api/accounts/:id/test — test SMTP + IMAP connectivity
router.post('/:id/test', async (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found.' });

  // Hard 15s deadline for the whole test
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      res.json({
        smtp: { ok: false, error: 'Connection timed out — port may be blocked by the hosting provider' },
        imap: { ok: false, error: 'Connection timed out' },
      });
    }
  }, 15000);

  try {
    const [smtp, imap] = await Promise.all([testSmtp(account), testImap(account)]);
    clearTimeout(timeout);
    if (!res.headersSent) res.json({ smtp, imap });
  } catch (err) {
    clearTimeout(timeout);
    if (!res.headersSent) res.json({
      smtp: { ok: false, error: err.message },
      imap: { ok: false, error: err.message },
    });
  }
});

module.exports = router;
