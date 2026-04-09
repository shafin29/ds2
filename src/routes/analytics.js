const express = require('express');
const db = require('../db');

const router = express.Router();

// GET /api/analytics/overview — totals across all campaigns
router.get('/overview', (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(DISTINCT c.id)   AS total_campaigns,
      COUNT(DISTINCT a.id)   AS total_accounts,
      COALESCE(SUM(s.sent), 0)    AS total_sent,
      COALESCE(SUM(s.replied), 0) AS total_replied,
      COALESCE(SUM(s.rescued), 0) AS total_rescued,
      COALESCE(SUM(s.spam), 0)    AS total_spam
    FROM campaigns c
    JOIN accounts a ON a.id = c.account_id
    LEFT JOIN daily_stats s ON s.campaign_id = c.id
  `).get();

  const replyRate = totals.total_sent > 0
    ? Math.round((totals.total_replied / totals.total_sent) * 100)
    : 0;

  res.json({ ...totals, reply_rate: replyRate });
});

// GET /api/analytics/campaigns/:id — daily chart data for one campaign
router.get('/campaigns/:id', (req, res) => {
  const { days = 30 } = req.query;

  const stats = db.prepare(`
    SELECT date, sent, replied, rescued, spam
    FROM daily_stats
    WHERE campaign_id = ?
    ORDER BY date ASC
    LIMIT ?
  `).all(req.params.id, parseInt(days));

  res.json(stats);
});

// GET /api/analytics/health — deliverability health score per campaign
router.get('/health', (req, res) => {
  const campaigns = db.prepare(`
    SELECT c.id, c.name, c.current_day, c.daily_target, c.status,
           a.email AS account_email,
           COALESCE(SUM(s.sent), 0)    AS total_sent,
           COALESCE(SUM(s.replied), 0) AS total_replied,
           COALESCE(SUM(s.rescued), 0) AS total_rescued,
           COALESCE(SUM(s.spam), 0)    AS total_spam
    FROM campaigns c
    JOIN accounts a ON a.id = c.account_id
    LEFT JOIN daily_stats s ON s.campaign_id = c.id
    GROUP BY c.id
    ORDER BY c.created_at DESC
  `).all();

  const health = campaigns.map(c => {
    const replyRate = c.total_sent > 0 ? c.total_replied / c.total_sent : 0;
    const spamRate  = c.total_sent > 0 ? c.total_spam / c.total_sent : 0;

    // Score: 0-100
    // +60 points from reply rate (target ≥ 30%)
    // +40 points from low spam rate (target 0%)
    const replyScore = Math.min(replyRate / 0.3, 1) * 60;
    const spamScore  = Math.max(1 - spamRate / 0.05, 0) * 40;
    const score      = Math.round(replyScore + spamScore);

    let grade = 'Poor';
    if (score >= 80) grade = 'Excellent';
    else if (score >= 60) grade = 'Good';
    else if (score >= 40) grade = 'Fair';

    return {
      id: c.id,
      name: c.name,
      account_email: c.account_email,
      status: c.status,
      current_day: c.current_day,
      daily_target: c.daily_target,
      total_sent: c.total_sent,
      total_replied: c.total_replied,
      total_rescued: c.total_rescued,
      reply_rate: Math.round(replyRate * 100),
      spam_rate: Math.round(spamRate * 100),
      health_score: score,
      grade,
    };
  });

  res.json(health);
});

module.exports = router;
