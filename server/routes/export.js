const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { readDB } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware, adminOnly);

// Mirror db.js's data dir so we export from the same place the app reads/writes.
const DATA_DIR = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(__dirname, '../data');

// Collections holding password hashes — strip them from the export.
const SENSITIVE = new Set(['staff', 'users', 'attendance_managers']);

// GET /api/export — download a COMPLETE snapshot of every collection as JSON.
// This is the "download all data" backup: staff, admins, attendance, leaves,
// merits, customers, diary — everything on disk, with passwords removed.
router.get('/', async (req, res) => {
  try {
    // Every *.json collection living directly in the data dir (the `backups`
    // sub-folder is a directory, so the .json filter skips it automatically).
    const files = (await fs.readdir(DATA_DIR)).filter(f => f.endsWith('.json'));
    const allData = {};

    for (const file of files) {
      const col = file.replace(/\.json$/, '');
      let data = await readDB(col);
      if (Array.isArray(data) && SENSITIVE.has(col)) {
        data = data.map(({ password: _p, ...rest }) => rest);
      }
      allData[col] = data;
    }

    await logAudit(req.user.id, req.user.name, 'export', 'all', null, `Full data export (${files.length} collections)`);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="kaamkaro-export-${new Date().toISOString().split('T')[0]}.json"`);
    res.json({
      exportedAt:  new Date().toISOString(),
      exportedBy:  req.user.name,
      collections: files.map(f => f.replace(/\.json$/, '')),
      data: allData,
    });
  } catch (err) {
    console.error('[Export]', err);
    res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;
