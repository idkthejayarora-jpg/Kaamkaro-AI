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

const VALID_TYPES = ['full_day', 'half_day_am', 'half_day_pm', 'sick', 'emergency'];
const VALID_REASONS = ['emergency', 'family', 'sick', 'travel', 'personal'];

// IST "today" as YYYY-MM-DD (app convention: Asia/Kolkata)
function istToday() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' });
}

// ── STAFF SELF-SERVICE (auth only — declared BEFORE the admin gate) ────────────

// GET /api/leaves/mine — a staff member's own leaves (optionally ?month=YYYY-MM)
router.get('/mine', async (req, res) => {
  try {
    let leaves = await readDB('leaves');
    leaves = leaves.filter(l => l.staffId === req.user.id);
    if (req.query.month) leaves = leaves.filter(l => l.date.startsWith(req.query.month));
    leaves.sort((a, b) => b.date.localeCompare(a.date));
    res.json(leaves);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leaves/self — staff marks their OWN leave (auto-approved).
// Body: { date, reasonCategory, reason?, type? }. staffId is forced to the
// authenticated user — a staff member can never mark leave for someone else.
router.post('/self', async (req, res) => {
  try {
    const { date, reasonCategory, reason, type } = req.body;
    const leaveType = type || 'full_day';

    if (!date || !reasonCategory) {
      return res.status(400).json({ error: 'date and reasonCategory are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    if (date < istToday()) {
      return res.status(400).json({ error: 'Cannot mark leave for a past date' });
    }
    if (!VALID_REASONS.includes(reasonCategory)) {
      return res.status(400).json({ error: `reasonCategory must be one of: ${VALID_REASONS.join(', ')}` });
    }
    if (!VALID_TYPES.includes(leaveType)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }

    const staff = await readDB('staff');
    const member = staff.find(s => s.id === req.user.id);
    if (!member) return res.status(404).json({ error: 'Staff not found' });

    const record = {
      id:             uuidv4(),
      staffId:        req.user.id,
      staffName:      member.name,
      date,
      type:           leaveType,
      reasonCategory,
      reason:         (reason || '').trim().slice(0, 1000),
      markedBy:       member.name,
      markedByRole:   'staff',
      selfMarked:     true,
      status:         'approved', // auto-approved per policy (double-confirmed in UI)
      createdAt:      new Date().toISOString(),
    };

    const dup = await withLock('leaves', async () => {
      const leaves = await readDB('leaves');
      if (leaves.find(l => l.staffId === req.user.id && l.date === date)) return true;
      leaves.push(record);
      await writeDB('leaves', leaves);
      return false;
    });
    if (dup) return res.status(409).json({ error: `You already have a leave marked for ${date}` });

    res.status(201).json(record);
  } catch (err) {
    console.error('[Leaves self]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/leaves/mine/:id — staff cancels their OWN leave only
router.delete('/mine/:id', async (req, res) => {
  try {
    const removed = await withLock('leaves', async () => {
      const leaves = await readDB('leaves');
      const idx = leaves.findIndex(l => l.id === req.params.id && l.staffId === req.user.id);
      if (idx === -1) return false;
      leaves.splice(idx, 1);
      await writeDB('leaves', leaves);
      return true;
    });
    if (!removed) return res.status(404).json({ error: 'Leave not found' });
    res.json({ message: 'Leave cancelled' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── ADMIN / ATTENDANCE-MANAGER ONLY (everything below this gate) ───────────────
router.use(attendanceManagerOrAdmin);

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

    // Atomic duplicate-check + insert — prevents two concurrent posts both passing the check
    const dup = await withLock('leaves', async () => {
      const leaves = await readDB('leaves');
      if (leaves.find(l => l.staffId === staffId && l.date === date)) return true;
      leaves.push(record);
      await writeDB('leaves', leaves);
      return false;
    });
    if (dup) return res.status(409).json({ error: `Leave already marked for ${member.name} on ${date}` });

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
