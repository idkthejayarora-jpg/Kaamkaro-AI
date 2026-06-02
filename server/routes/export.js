const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { buildFullExport } = require('../utils/exportData');

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

module.exports = router;
