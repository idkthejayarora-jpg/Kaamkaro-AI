const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne } = require('../utils/db');
const { authMiddleware, attendanceManagerOrAdmin } = require('../middleware/auth');
const { broadcast } = require('../utils/sse');

const router = express.Router();
router.use(authMiddleware);

// POST /api/broadcast — admin or attendance_manager sends a message to all connected staff
router.post('/', attendanceManagerOrAdmin, async (req, res) => {
  try {
    const { message, title } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message required' });
    if (message.length > 5000) return res.status(413).json({ error: 'Message too long (max 5000 characters)' });

    const msg = {
      id:      uuidv4(),
      title:   title?.trim() || null,
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

// GET /api/broadcast — recent broadcasts (all authenticated users)
router.get('/', async (req, res) => {
  try {
    const list = await readDB('broadcasts');
    res.json(list.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt)).slice(0, 30));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
