const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/templates?type=subject|body|reply
router.get('/', (req, res) => {
  const { type } = req.query;
  const query = type
    ? db.prepare('SELECT * FROM templates WHERE type = ? ORDER BY created_at ASC')
    : db.prepare('SELECT * FROM templates ORDER BY type, created_at ASC');
  res.json(type ? query.all(type) : query.all());
});

// POST /api/templates
router.post('/', (req, res) => {
  const { type, content } = req.body;
  if (!type || !content) return res.status(400).json({ error: 'type and content are required.' });
  if (!['subject', 'body', 'reply'].includes(type)) {
    return res.status(400).json({ error: 'type must be subject, body, or reply.' });
  }
  const result = db.prepare('INSERT INTO templates (type, content) VALUES (?, ?)').run(type, content.trim());
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(template);
});

// PATCH /api/templates/:id
router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const template = db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
  if (!template) return res.status(404).json({ error: 'Template not found.' });

  const { content, active } = req.body;
  const updates = [];
  const values = [];

  if (content !== undefined) { updates.push('content = ?'); values.push(content.trim()); }
  if (active !== undefined)  { updates.push('active = ?');  values.push(active ? 1 : 0); }

  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update.' });

  values.push(id);
  db.prepare(`UPDATE templates SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json(db.prepare('SELECT * FROM templates WHERE id = ?').get(id));
});

// DELETE /api/templates/:id
router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Template not found.' });
  res.json({ ok: true });
});

module.exports = router;
