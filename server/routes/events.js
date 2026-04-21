// ─────────────────────────────────────────────────────────────────────────────
// GET /api/events  — SSE stream for real-time UI updates
// Token may be passed as Bearer header OR ?token= query param (EventSource limitation)
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const jwt     = require('jsonwebtoken');
const router  = express.Router();
const { addClient } = require('../utils/sse');
const { JWT_SECRET } = require('../middleware/auth');

router.get('/', (req, res) => {
  // Accept token from header OR query string (EventSource can't set headers)
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : req.query.token;

  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  try {
    jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  addClient(res);
  // Note: response stays open intentionally — no res.end()
});

module.exports = router;
