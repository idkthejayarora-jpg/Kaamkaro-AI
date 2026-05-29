/**
 * Leave management routes — attendance_manager + admin only.
 * Leaves are marked directly as approved (no approval workflow).
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB, deleteOne, withLock } = require('../utils/db');
const { authMiddleware, attendanceManagerOrAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.use(attendanceManagerOrAdmin);

const VALID_TYPES = ['full_day', 'half_day_am', 'half_day_pm', 'sick', 'emergency'];

// ── GET /api/leaves ────────────────────────────────────────────────────────────
// Query: ?staffId=  &month=YYYY-MM
router.get('/', async (req, res) => {
  try {
    let leaves = await readDB('leaves');
    const { staffId, month } = req.query;
    if (staffId) leaves = leaves.filter(l => l.staffId === staffId);
    if (month)   leaves = leaves.filter(l => l.date.startsWith(month));
    leaves.sort((a, b) => b.date.localeCompare(a.date));
    res.json(leaves);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/leaves ───────────────────────────────────────────────────────────
// Body: { staffId, date, type, reason? }
router.post('/', async (req, res) => {
  try {
    const { staffId, date, type, reason } = req.body;
    if (!staffId || !date || !type) {
      return res.status(400).json({ error: 'staffId, date, and type are required' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    // Date format check
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    // Get staff name
    const staff = await readDB('staff');
    const member = staff.find(s => s.id === staffId);
    if (!member) return res.status(404).json({ error: 'Staff not found' });

    // Check for duplicate leave on same date
    const leaves = await readDB('leaves');
    const existing = leaves.find(l => l.staffId === staffId && l.date === date);
    if (existing) {
      return res.status(409).json({ error: `Leave already marked for ${member.name} on ${date}` });
    }

    const record = {
      id:           uuidv4(),
      staffId,
      staffName:    member.name,
      date,
      type,
      reason:       reason?.trim() || '',
      markedBy:     req.user.name,
      markedByRole: req.user.role,
      status:       'approved',
      createdAt:    new Date().toISOString(),
    };

    leaves.push(record);
    await writeDB('leaves', leaves);
    res.status(201).json(record);
  } catch (err) {
    console.error('[Leaves POST]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/leaves/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteOne('leaves', req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Leave not found' });
    res.json({ message: 'Leave cancelled' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
