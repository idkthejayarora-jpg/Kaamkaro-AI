const express = require('express');
const { readDB } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, adminOnly);

// GET /api/audit?limit=50&resource=&userId=
router.get('/', async (req, res) => {
  try {
    let log = await readDB('auditLog');
    const { resource, userId, limit = 100 } = req.query;
    if (resource) log = log.filter(l => l.resource === resource);
    if (userId)   log = log.filter(l => l.userId === userId);
    log.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    res.json(log.slice(0, Number(limit)));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
