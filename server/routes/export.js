const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { buildFullExport } = require('../utils/exportData');
const gdrive = require('../utils/gdrive');

const router = express.Router();
router.use(authMiddleware, adminOnly);

// GET /api/export — download a COMPLETE snapshot of every collection as JSON.
// This is the "download all data" backup: staff, admins, attendance, leaves,
// merits, customers, diary — everything on disk, with passwords removed.
router.get('/', async (req, res) => {
  try {
    const payload = await buildFullExport(req.user.name);
    await logAudit(req.user.id, req.user.name, 'export', 'all', null, `Full data export (${payload.collections.length} collections)`);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="kaamkaro-export-${new Date().toISOString().split('T')[0]}.json"`);
    res.json(payload);
  } catch (err) {
    console.error('[Export]', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

// GET /api/export/gdrive/status — is the Google Drive backup configured?
router.get('/gdrive/status', (req, res) => {
  res.json({ configured: gdrive.isConfigured() });
});

// POST /api/export/gdrive/now — upload a backup to Google Drive right now.
// Lets an admin verify the Drive setup without waiting for the midnight job.
router.post('/gdrive/now', async (req, res) => {
  if (!gdrive.isConfigured()) {
    return res.status(400).json({ error: 'Google Drive backup is not configured on the server.' });
  }
  try {
    const dateStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
    const payload = await buildFullExport(req.user.name);
    const file = await gdrive.uploadDailyBackup(JSON.stringify(payload, null, 2), dateStr);
    await logAudit(req.user.id, req.user.name, 'export', 'all', null, `Manual Google Drive backup → ${dateStr}`);
    res.json({ ok: true, folder: dateStr, file: file.name });
  } catch (err) {
    console.error('[Export gdrive/now]', err);
    res.status(502).json({ error: `Drive upload failed: ${err.message}` });
  }
});

module.exports = router;
