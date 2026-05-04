/**
 * Badges API
 *
 * GET  /api/badges/meta      — full badge catalogue (labels, icons, tiers, descriptions)
 * GET  /api/badges/criteria  — current thresholds (default + any admin overrides)
 * PUT  /api/badges/criteria  — admin: save new thresholds to config
 * GET  /api/badges           — earned badges (admin: all/filtered; staff: own)
 */

const express = require('express');
const { readDB, insertOne, updateOne } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { BADGES, DEFAULT_CRITERIA, loadCriteria } = require('../utils/badgeEarner');

const router = express.Router();
router.use(authMiddleware);

// ── GET /api/badges/meta — full badge catalogue ───────────────────────────────
router.get('/meta', (req, res) => {
  res.json(BADGES);
});

// ── GET /api/badges/criteria — current thresholds ────────────────────────────
router.get('/criteria', async (req, res) => {
  try {
    const criteria = await loadCriteria();
    res.json({ criteria, defaults: DEFAULT_CRITERIA });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/badges/criteria — admin saves new thresholds ────────────────────
router.put('/criteria', adminOnly, async (req, res) => {
  try {
    const { criteria } = req.body;
    if (!criteria || typeof criteria !== 'object') {
      return res.status(400).json({ error: 'criteria object required' });
    }

    // Basic validation — all numeric values must be positive integers
    const flat = [
      criteria.tasks?.bronze, criteria.tasks?.silver, criteria.tasks?.gold,
      criteria.streak?.bronze, criteria.streak?.silver, criteria.streak?.gold,
      criteria.deals?.bronze, criteria.deals?.silver, criteria.deals?.gold,
      criteria.merits?.bronze, criteria.merits?.silver, criteria.merits?.gold,
      criteria.tenure?.bronze, criteria.tenure?.silver, criteria.tenure?.gold,
      criteria.response?.bronze?.rate, criteria.response?.bronze?.minInteractions,
      criteria.response?.gold?.rate,   criteria.response?.gold?.minInteractions,
      criteria.loopTasks?.bronze, criteria.loopTasks?.silver,
    ].filter(v => v !== undefined);

    if (flat.some(v => typeof v !== 'number' || v < 0 || !Number.isFinite(v))) {
      return res.status(400).json({ error: 'All threshold values must be non-negative numbers' });
    }

    // Tier ordering validation (bronze ≤ silver ≤ gold where applicable)
    const tiers = ['tasks', 'streak', 'deals', 'merits', 'tenure'];
    for (const cat of tiers) {
      const t = criteria[cat];
      if (!t) continue;
      if (t.bronze > t.silver || t.silver > t.gold) {
        return res.status(400).json({ error: `${cat}: bronze must be ≤ silver ≤ gold` });
      }
    }
    if (criteria.loopTasks && criteria.loopTasks.bronze > criteria.loopTasks.silver) {
      return res.status(400).json({ error: 'loopTasks: bronze must be ≤ silver' });
    }
    if (criteria.response?.bronze?.rate > criteria.response?.gold?.rate) {
      return res.status(400).json({ error: 'response: bronze rate must be ≤ gold rate' });
    }

    const value = JSON.stringify(criteria);
    const config = await readDB('config').catch(() => []);
    const existing = config.find(c => c.key === 'badgeCriteria');

    if (existing) {
      await updateOne('config', existing.id, { value });
    } else {
      await insertOne('config', {
        id:    require('crypto').randomUUID(),
        key:   'badgeCriteria',
        value,
      });
    }

    console.log(`[Badge] ⚙️  Criteria updated by admin`);
    res.json({ message: 'Badge criteria saved', criteria });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/badges — earned badges ──────────────────────────────────────────
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
