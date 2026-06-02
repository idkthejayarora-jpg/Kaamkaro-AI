const { snapshotAllCollections } = require('./db');
const gdrive = require('./gdrive');
const { buildFullExport } = require('./exportData');

// Build the full export and push it to Google Drive (day-wise folder).
// No-op when Drive env vars aren't set; never throws into the scheduler.
async function uploadToGoogleDrive() {
  if (!gdrive.isConfigured()) return;
  try {
    const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD IST
    const payload = await buildFullExport('daily-backup');
    const file = await gdrive.uploadDailyBackup(JSON.stringify(payload, null, 2), dateStr);
    console.log(`☁️  Google Drive backup uploaded → ${dateStr}/${file.name}`);
  } catch (err) {
    console.error('[Backup] Google Drive upload failed (non-fatal):', err.message);
  }
}

// ── Daily backup scheduler ────────────────────────────────────────────────────
// Self-correcting setTimeout that fires at 00:00 IST (Asia/Kolkata) every day,
// snapshots all collections, then reschedules for the next midnight. No external
// cron dependency needed, and it stays accurate across DST-free IST + drift.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30 (no DST)

// Milliseconds from now until the next 00:00 IST.
function msUntilNextIstMidnight() {
  const now = Date.now();
  // Shift "now" into IST wall-clock space, find the start of the next IST day,
  // then shift that instant back to a real UTC timestamp.
  const istNow = new Date(now + IST_OFFSET_MS);
  const nextIstMidnight = Date.UTC(
    istNow.getUTCFullYear(),
    istNow.getUTCMonth(),
    istNow.getUTCDate() + 1, // start of next IST day
    0, 0, 0, 0,
  ) - IST_OFFSET_MS;
  return Math.max(1000, nextIstMidnight - now);
}

let timer = null;

function scheduleNext() {
  const delay = msUntilNextIstMidnight();
  const fireAt = new Date(Date.now() + delay).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  console.log(`🗓️  Next daily backup scheduled for ${fireAt} IST (in ${(delay / 3600000).toFixed(1)}h)`);

  timer = setTimeout(async () => {
    try {
      await snapshotAllCollections('daily');
      await uploadToGoogleDrive(); // off-site copy → Google Drive (if configured)
    } catch (err) {
      console.error('[Backup] Daily snapshot failed (non-fatal):', err.message);
    } finally {
      scheduleNext(); // reschedule regardless of success/failure
    }
  }, delay);

  // Don't keep the event loop alive solely for the backup timer
  if (timer.unref) timer.unref();
}

function startDailyBackup() {
  scheduleNext();
}

module.exports = { startDailyBackup, msUntilNextIstMidnight, uploadToGoogleDrive };
