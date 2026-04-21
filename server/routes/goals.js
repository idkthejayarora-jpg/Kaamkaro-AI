const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);

// GET /api/goals  — admin sees all, staff sees their own
router.get('/', async (req, res) => {
  try {
    let goals = await readDB('goals');
    if (req.user.role === 'staff') {
      goals = goals.filter(g => g.staffId === req.user.id);
    }
    // Attach current progress
    const interactions = await readDB('interactions');
    const tasks        = await readDB('tasks');
    const now          = new Date();
    const monthStart   = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    goals = goals.map(g => {
      let current = 0;
      if (g.metric === 'calls') {
        current = interactions.filter(i =>
          i.staffId === g.staffId && i.type === 'call' && i.createdAt >= monthStart
        ).length;
      } else if (g.metric === 'interactions') {
        current = interactions.filter(i =>
          i.staffId === g.staffId && i.createdAt >= monthStart
        ).length;
      } else if (g.metric === 'tasks_completed') {
        current = tasks.filter(t =>
          t.staffId === g.staffId && t.completed && t.completedAt >= monthStart
        ).length;
      } else if (g.metric === 'response_rate') {
        const monthInteractions = interactions.filter(i =>
          i.staffId === g.staffId && i.createdAt >= monthStart
        );
        current = monthInteractions.length > 0
          ? Math.round(monthInteractions.filter(i => i.responded).length / monthInteractions.length * 100)
          : 0;
      }
      return { ...g, current, progress: g.target > 0 ? Math.min(100, Math.round(current / g.target * 100)) : 0 };
    });

    res.json(goals);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/goals — admin only
router.post('/', adminOnly, async (req, res) => {
  try {
    const { staffId, metric, target, label, month } = req.body;
    if (!staffId || !metric || !target) {
      return res.status(400).json({ error: 'staffId, metric, target required' });
    }
    const validMetrics = ['calls', 'interactions', 'tasks_completed', 'response_rate'];
    if (!validMetrics.includes(metric)) {
      return res.status(400).json({ error: 'Invalid metric' });
    }
    const goal = {
      id: uuidv4(),
      staffId,
      metric,
      target: Number(target),
      label: label || metric,
      month: month || new Date().toISOString().slice(0, 7), // YYYY-MM
      createdAt: new Date().toISOString(),
      createdBy: req.user.id,
    };
    await insertOne('goals', goal);
    await logAudit(req.user.id, req.user.name, 'create', 'goal', goal.id, `Set goal for staff ${staffId}: ${metric} = ${target}`);
    res.status(201).json({ ...goal, current: 0, progress: 0 });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/goals/:id — admin only
router.patch('/:id', adminOnly, async (req, res) => {
  try {
    const { target, label } = req.body;
    const updated = await updateOne('goals', req.params.id, { target: Number(target), label });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/goals/:id — admin only
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const deleted = await deleteOne('goals', req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await logAudit(req.user.id, req.user.name, 'delete', 'goal', req.params.id, 'Goal deleted');
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
