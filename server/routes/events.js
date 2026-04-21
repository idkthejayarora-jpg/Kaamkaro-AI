// ─────────────────────────────────────────────────────────────────────────────
// GET /api/events  — SSE stream for real-time UI updates
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router  = express.Router();
const { addClient } = require('../utils/sse');

router.get('/', (req, res) => {
  addClient(res);
  // Note: response stays open — no res.end()
});

module.exports = router;
