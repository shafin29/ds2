const express = require('express');
const cors = require('cors');
const path = require('path');

const accountsRouter   = require('./src/routes/accounts');
const campaignsRouter  = require('./src/routes/campaigns');
const analyticsRouter  = require('./src/routes/analytics');
const templatesRouter  = require('./src/routes/templates');
const scheduler        = require('./src/scheduler');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/accounts',   accountsRouter);
app.use('/api/campaigns',  campaignsRouter);
app.use('/api/analytics',  analyticsRouter);
app.use('/api/templates',  templatesRouter);

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[Server]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`\n  Email Warmup Tool`);
  console.log(`  Running at http://localhost:${PORT}`);
  console.log(`  Press Ctrl+C to stop\n`);

  // Start the background warmup scheduler
  scheduler.start();
});
