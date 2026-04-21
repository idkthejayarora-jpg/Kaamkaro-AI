const express = require('express');
const { readDB } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware, adminOnly);

// GET /api/export — download all data as JSON
router.get('/', async (req, res) => {
  try {
    const collections = ['staff', 'customers', 'vendors', 'performance', 'interactions', 'tasks', 'diary', 'auditLog'];
    const allData = {};

    for (const col of collections) {
      const data = await readDB(col);
      // Strip passwords from staff
      if (col === 'staff') {
        allData[col] = data.map(({ password: _, ...s }) => s);
      } else {
        allData[col] = data;
      }
    }

    await logAudit(req.user.id, req.user.name, 'export', 'all', null, 'Full data export');

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="kaamkaro-export-${new Date().toISOString().split('T')[0]}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      exportedBy: req.user.name,
      data: allData,
    });
  } catch (err) {
    res.status(500).json({ error: 'Export failed' });
  }
});

module.exports = router;
