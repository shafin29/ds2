/**
 * Scheduler — runs warmup cycles and inbox processing on a cron schedule.
 */

const cron = require('node-cron');
const { runWarmupCycle, runInboxProcessing } = require('./warmupEngine');

let sendJob = null;
let inboxJob = null;
let isRunning = false;

function start() {
  if (isRunning) return;
  isRunning = true;

  // Send warmup emails every 20 minutes
  // (actual sending is gated by each campaign's hour window)
  sendJob = cron.schedule('*/20 * * * *', async () => {
    console.log('[Scheduler] Running warmup send cycle...');
    try {
      await runWarmupCycle();
    } catch (err) {
      console.error('[Scheduler] Send cycle error:', err.message);
    }
  });

  // Process inboxes (reply + rescue from spam) every 30 minutes
  inboxJob = cron.schedule('*/30 * * * *', async () => {
    console.log('[Scheduler] Running inbox processing...');
    try {
      await runInboxProcessing();
    } catch (err) {
      console.error('[Scheduler] Inbox processing error:', err.message);
    }
  });

  console.log('[Scheduler] Started — send cycle: every 20min, inbox: every 30min');
}

function stop() {
  sendJob?.stop();
  inboxJob?.stop();
  isRunning = false;
  console.log('[Scheduler] Stopped.');
}

module.exports = { start, stop };
