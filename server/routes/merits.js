const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne, writeDB } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { awardMerit } = require('../utils/merits');
const { checkAndAwardBadges } = require('../utils/badgeEarner');

const router = express.Router();
router.use(authMiddleware);

// ── GET /api/merits — list merit events ────────────────────────────────────────
// Admin: all staff. Staff: own only.
router.get('/', async (req, res) => {
  try {
    let merits = await readDB('merits');
    if (req.user.role === 'staff') {
      merits = merits.filter(m => m.staffId === req.user.id);
    }
    const { staffId, limit } = req.query;
    if (staffId && req.user.role === 'admin') merits = merits.filter(m => m.staffId === staffId);
    merits.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (limit) merits = merits.slice(0, parseInt(limit, 10));
    res.json(merits);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/merits/summary — per-staff aggregated totals ─────────────────────
router.get('/summary', async (req, res) => {
  try {
    const merits = await readDB('merits');
    const staff  = await readDB('staff');
    const today  = new Date();
    const weekAgo  = new Date(today - 7  * 86400000).toISOString();
    const monthAgo = new Date(today - 30 * 86400000).toISOString();

    const summary = staff.map(s => {
      const own      = merits.filter(m => m.staffId === s.id);
      const week     = own.filter(m => m.createdAt >= weekAgo);
      const month    = own.filter(m => m.createdAt >= monthAgo);
      const total    = own.reduce((sum, m) => sum + m.points, 0);
      const weekPts  = week.reduce((sum, m) => sum + m.points, 0);
      const monthPts = month.reduce((sum, m) => sum + m.points, 0);

      // Category breakdown
      const byCategory = (events) => ({
        task:       events.filter(m => m.category === 'task'       && m.points > 0).reduce((s, m) => s + m.points, 0),
        streak:     events.filter(m => m.category === 'streak'     && m.points > 0).reduce((s, m) => s + m.points, 0),
        conversion: events.filter(m => m.category === 'conversion').reduce((s, m) => s + m.points, 0),
        penalties:  events.filter(m => m.points < 0).reduce((s, m) => s + m.points, 0),
      });

      return {
        staffId:   s.id,
        name:      s.name,
        avatar:    s.avatar,
        total,
        weekPts,
        monthPts,
        breakdown: byCategory(own),
        weekBreak: byCategory(week),
        recentEvents: own.slice(0, 5),
      };
    });

    summary.sort((a, b) => b.total - a.total);
    res.json(summary);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/merits/award — admin manually awards / deducts points ────────────
router.post('/award', adminOnly, async (req, res) => {
  try {
    const { staffId, points, reason } = req.body;
    if (!staffId || points === undefined || !reason) {
      return res.status(400).json({ error: 'staffId, points, and reason required' });
    }
    const staff = await readDB('staff');
    const s = staff.find(x => x.id === staffId);
    if (!s) return res.status(404).json({ error: 'Staff not found' });

    const event = await awardMerit(staffId, s.name, Number(points), reason, 'manual', null);
    // Badge check after any merit award (non-blocking)
    checkAndAwardBadges(staffId, { event: 'merit' }).catch(() => {});
    res.status(201).json(event);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/merits/goals — point-based goals set by admin ────────────────────
router.get('/goals', async (req, res) => {
  try {
    let goals = await readDB('meritGoals');
    if (req.user.role === 'staff') {
      goals = goals.filter(g => g.staffId === req.user.id);
    }
    res.json(goals);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/merits/goals — create / replace a goal for a staff member ───────
router.post('/goals', adminOnly, async (req, res) => {
  try {
    const { staffId, targetPoints, period, reward } = req.body;
    if (!staffId || !targetPoints || !period) {
      return res.status(400).json({ error: 'staffId, targetPoints, period required' });
    }
    const staff = await readDB('staff');
    const s = staff.find(x => x.id === staffId);
    if (!s) return res.status(404).json({ error: 'Staff not found' });

    // Replace existing goal for same staff+period
    let goals = await readDB('meritGoals');
    const existing = goals.find(g => g.staffId === staffId && g.period === period);
    let goal;
    if (existing) {
      goal = await updateOne('meritGoals', existing.id, { targetPoints: Number(targetPoints), reward: reward || '' });
    } else {
      goal = { id: uuidv4(), staffId, staffName: s.name, targetPoints: Number(targetPoints), period, reward: reward || '', createdAt: new Date().toISOString() };
      await insertOne('meritGoals', goal);
    }
    res.status(201).json(goal);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/merits/goals/:id ──────────────────────────────────────────────
router.delete('/goals/:id', adminOnly, async (req, res) => {
  try {
    const deleted = await deleteOne('meritGoals', req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Goal not found' });
    res.json({ message: 'Goal deleted' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
