const express = require('express');
const { readDB } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, adminOnly);

// GET /api/admin/orphans
// Scans tasks, diary, leads, chat for references to deleted staff / customers.
// Returns a list of orphan buckets for admin visibility — no auto-cleanup.
router.get('/orphans', async (req, res) => {
  try {
    const [staff, customers, tasks, diary, leads, conversations] = await Promise.all([
      readDB('staff'),
      readDB('customers'),
      readDB('tasks'),
      readDB('diary'),
      readDB('leads'),
      readDB('conversations'),
    ]);

    const staffIds    = new Set(staff.map(s => s.id));
    const customerIds = new Set(customers.map(c => c.id));

    const orphans = {
      tasks: tasks
        .filter(t => t.staffId && !staffIds.has(t.staffId))
        .map(t => ({ id: t.id, label: t.title, missingRef: 'staffId', missingId: t.staffId })),

      taskCustomers: tasks
        .filter(t => t.customerId && !customerIds.has(t.customerId))
        .map(t => ({ id: t.id, label: t.title, missingRef: 'customerId', missingId: t.customerId })),

      diary: diary
        .filter(d => d.staffId && !staffIds.has(d.staffId))
        .map(d => ({ id: d.id, label: d.content?.substring(0, 60) || d.id, missingRef: 'staffId', missingId: d.staffId })),

      leads: leads
        .filter(l => l.assignedTo && !staffIds.has(l.assignedTo))
        .map(l => ({ id: l.id, label: l.name || l.id, missingRef: 'assignedTo', missingId: l.assignedTo })),

      chatMembers: conversations
        .filter(c => Array.isArray(c.members) && c.members.some(m => !staffIds.has(m)))
        .map(c => ({
          id: c.id,
          label: c.name || `${c.type} conversation`,
          missingRef: 'members',
          missingId: c.members.filter(m => !staffIds.has(m)).join(', '),
        })),
    };

    const totalOrphans = Object.values(orphans).reduce((sum, arr) => sum + arr.length, 0);
    res.json({ orphans, totalOrphans, scannedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[Admin orphans]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
