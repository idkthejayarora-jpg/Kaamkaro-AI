/**
 * GET /api/badges          — list earned badges
 *   Admin: all staff (or filter by ?staffId=)
 *   Staff: own badges only
 *
 * GET /api/badges/meta     — returns full BADGES catalogue (for frontend display)
 */

const express = require('express');
const { readDB } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { BADGES } = require('../utils/badgeEarner');

const router = express.Router();
router.use(authMiddleware);

// GET /api/badges/meta — full badge catalogue for frontend
router.get('/meta', (req, res) => {
  res.json(BADGES);
});

// GET /api/badges — earned badges
router.get('/', async (req, res) => {
  try {
    let badges = await readDB('badges').catch(() => []);

    if (req.user.role === 'staff') {
      badges = badges.filter(b => b.staffId === req.user.id);
    } else if (req.query.staffId) {
      badges = badges.filter(b => b.staffId === req.query.staffId);
    }

    badges.sort((a, b) => new Date(b.earnedAt) - new Date(a.earnedAt));
    res.json(badges);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
