const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { runWarmupCycle, runInboxProcessing } = require('../warmupEngine');

const router = express.Router();

// GET /api/campaigns
router.get('/', (req, res) => {
  const campaigns = db.prepare(`
    SELECT c.*, a.email AS account_email, a.name AS account_name
    FROM campaigns c
    JOIN accounts a ON a.id = c.account_id
    ORDER BY c.created_at DESC
  `).all();
  res.json(campaigns);
});

// GET /api/campaigns/:id
router.get('/:id', (req, res) => {
  const campaign = db.prepare(`
    SELECT c.*, a.email AS account_email, a.name AS account_name
    FROM campaigns c
    JOIN accounts a ON a.id = c.account_id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });
  res.json(campaign);
});

// POST /api/campaigns — create a campaign for an account
router.post('/', (req, res) => {
  const {
    account_id, name,
    daily_target = 5,
    max_per_day = 50,
    ramp_increment = 5,
    send_hour_start = 8,
    send_hour_end = 18,
  } = req.body;

  if (!account_id || !name) {
    return res.status(400).json({ error: 'account_id and name are required.' });
  }

  const account = db.prepare("SELECT id FROM accounts WHERE id = ? AND role = 'sender'").get(account_id);
  if (!account) return res.status(404).json({ error: 'Sender account not found. Make sure the account role is set to Sender.' });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO campaigns (id, account_id, name, daily_target, max_per_day,
                           ramp_increment, send_hour_start, send_hour_end)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, account_id, name, daily_target, max_per_day, ramp_increment, send_hour_start, send_hour_end);

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  res.status(201).json(campaign);
});

// PATCH /api/campaigns/:id — update status or settings
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

  const fields = ['name', 'status', 'daily_target', 'max_per_day', 'ramp_increment',
                  'send_hour_start', 'send_hour_end'];
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
  db.prepare(`UPDATE campaigns SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json(db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id));
});

// DELETE /api/campaigns/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Campaign not found.' });
  res.json({ ok: true });
});

// POST /api/campaigns/:id/trigger — manually trigger a warmup cycle
router.post('/:id/trigger', async (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found.' });

  try {
    await runWarmupCycle(true); // force = bypass time window
    res.json({ ok: true, message: 'Warmup cycle triggered.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/campaigns/inbox — manually trigger inbox processing
router.post('/inbox/process', async (req, res) => {
  try {
    await runInboxProcessing();
    res.json({ ok: true, message: 'Inbox processing triggered.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/campaigns/:id/emails — recent warmup emails for a campaign
router.get('/:id/emails', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const emails = db.prepare(`
    SELECT e.*,
           fa.email AS from_email, fa.name AS from_name,
           ta.email AS to_email, ta.name AS to_name
    FROM warmup_emails e
    JOIN accounts fa ON fa.id = e.from_account_id
    JOIN accounts ta ON ta.id = e.to_account_id
    WHERE e.campaign_id = ?
    ORDER BY e.sent_at DESC
    LIMIT ?
  `).all(req.params.id, limit);
  res.json(emails);
});

module.exports = router;
