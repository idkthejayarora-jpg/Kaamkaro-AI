const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { broadcast } = require('../utils/sse');

const router = express.Router();
router.use(authMiddleware);

// POST /api/broadcast — admin sends a message to all connected staff
router.post('/', adminOnly, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message required' });

    const msg = {
      id:      uuidv4(),
      message: message.trim(),
      sentBy:  req.user.name,
      sentAt:  new Date().toISOString(),
    };

    await insertOne('broadcasts', msg);
    broadcast('admin:broadcast', msg);
    res.status(201).json(msg);
  } catch (err) {
    console.error('[Broadcast]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/broadcast — recent broadcasts (admin: all, staff: all visible)
router.get('/', async (req, res) => {
  try {
    const list = await readDB('broadcasts');
    res.json(list.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt)).slice(0, 30));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
