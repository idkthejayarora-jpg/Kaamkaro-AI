const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware, adminOnly, attendanceManagerOrAdmin } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { broadcast } = require('../utils/sse');

const router = express.Router();
router.use(authMiddleware);

// GET /api/staff
router.get('/', async (req, res) => {
  try {
    const staff = await readDB('staff');
    res.json(staff.map(({ password: _, ...s }) => s));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// checkin / checkout removed — attendance feature wiped

// GET /api/staff/face-check — staff with enrolled faces (JWT auth, no kiosk PIN needed)
router.get('/face-check', attendanceManagerOrAdmin, async (req, res) => {
  try {
    const staff = await readDB('staff');
    const withFaces = staff
      .filter(s => s.active !== false && s.faceDescriptors?.length)
      .map(({ id, name, faceDescriptors }) => ({ id, name, faceDescriptors }));
    res.json(withFaces);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/staff/me/face — staff self-enrolls their own face (no manager needed)
router.patch('/me/face', async (req, res) => {
  try {
    const { descriptors } = req.body;
    if (!Array.isArray(descriptors) || descriptors.length === 0)
      return res.status(400).json({ error: 'descriptors array required' });
    const updated = await updateOne('staff', req.user.id, { faceDescriptors: descriptors });
    if (!updated) return res.status(404).json({ error: 'Staff not found' });
    const { password: _, ...safe } = updated;
    res.json({ message: 'Face enrolled', staff: safe });
  } catch (err) {
    console.error('[Self face enroll]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/staff/:id
router.get('/:id', async (req, res) => {
  try {
    const staff = await readDB('staff');
    const s = staff.find(x => x.id === req.params.id);
    if (!s) return res.status(404).json({ error: 'Not found' });
    const { password: _, ...safe } = s;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/staff — create (admin only)
router.post('/', adminOnly, async (req, res) => {
  try {
    const { name, phone, password, email, customers = [] } = req.body;
    if (!name || !phone || !password) {
      return res.status(400).json({ error: 'Name, phone, and password are required' });
    }
    const existing = await readDB('staff');
    if (existing.find(s => s.phone === phone)) {
      return res.status(409).json({ error: 'Phone already registered' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const newStaff = {
      id: uuidv4(), name, phone, password: hashed, role: 'staff',
      email: email || '', avatar: initials, customers, active: true,
      joinDate: new Date().toISOString(), createdAt: new Date().toISOString(),
      streakData: { currentStreak: 0, lastActivityDate: null, longestStreak: 0 },
      availability: 'available', // 'available' | 'on_call' | 'out_of_office'
    };
    await insertOne('staff', newStaff);
    await logAudit(req.user.id, req.user.name, 'create', 'staff', newStaff.id, `Created staff: ${name}`);
    const { password: _, ...safe } = newStaff;
    res.status(201).json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/staff/:id — update
router.patch('/:id', adminOnly, async (req, res) => {
  try {
    const { password, ...updates } = req.body;
    if (password) updates.password = await bcrypt.hash(password, 10);
    const updated = await updateOne('staff', req.params.id, updates);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    await logAudit(req.user.id, req.user.name, 'update', 'staff', req.params.id, `Updated staff`);
    const { password: _, ...safe } = updated;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/staff/:id/reset-password — admin resets a staff password
router.post('/:id/reset-password', adminOnly, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const hashed = await bcrypt.hash(newPassword, 10);
    const updated = await updateOne('staff', req.params.id, { password: hashed });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    await logAudit(req.user.id, req.user.name, 'update', 'staff', req.params.id, 'Password reset by admin');
    res.json({ message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/staff/:id
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const deleted = await deleteOne('staff', req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await logAudit(req.user.id, req.user.name, 'delete', 'staff', req.params.id, 'Staff deleted');
    res.json({ message: 'Staff deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/staff/:id/availability — staff updates own status (or admin updates any)
router.patch('/:id/availability', async (req, res) => {
  try {
    const { availability } = req.body;
    const valid = ['available', 'on_call', 'out_of_office'];
    if (!valid.includes(availability)) return res.status(400).json({ error: 'Invalid availability' });
    // Staff can only update their own; admin can update any
    if (req.user.role === 'staff' && req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const updated = await updateOne('staff', req.params.id, { availability });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    const { password: _, ...safe } = updated;
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/staff/:id/shift — set per-staff shift override (or clear with null)
// Body: { shiftStart: 'HH:MM', shiftEnd: 'HH:MM' } OR { shiftOverride: null } to clear
router.patch('/:id/shift', attendanceManagerOrAdmin, async (req, res) => {
  try {
    const { shiftStart, shiftEnd, shiftOverride } = req.body;
    let update;
    if (shiftOverride === null) {
      update = { shiftOverride: null };
    } else {
      if (!shiftStart || !shiftEnd) {
        return res.status(400).json({ error: 'shiftStart and shiftEnd required' });
      }
      if (!/^\d{2}:\d{2}$/.test(shiftStart) || !/^\d{2}:\d{2}$/.test(shiftEnd)) {
        return res.status(400).json({ error: 'Times must be HH:MM format' });
      }
      update = { shiftOverride: { shiftStart, shiftEnd } };
    }
    const updated = await updateOne('staff', req.params.id, update);
    if (!updated) return res.status(404).json({ error: 'Staff not found' });
    const { password: _, ...safe } = updated;
    res.json(safe);
  } catch (err) {
    console.error('[Shift override]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/staff/:id/face — save face descriptors (admin or attendance_manager)
// Body: { descriptors: number[][] }  (array of 128-D float arrays)
router.patch('/:id/face', attendanceManagerOrAdmin, async (req, res) => {
  try {
    const { descriptors } = req.body;
    if (!Array.isArray(descriptors) || descriptors.length === 0) {
      return res.status(400).json({ error: 'descriptors array required' });
    }
    const updated = await updateOne('staff', req.params.id, { faceDescriptors: descriptors });
    if (!updated) return res.status(404).json({ error: 'Staff not found' });
    const { password: _, ...safe } = updated;
    res.json({ message: 'Face enrolled', staff: safe });
  } catch (err) {
    console.error('[Face enroll]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/staff/:id/tour — enable/disable self-checkin for touring staff
router.patch('/:id/tour', attendanceManagerOrAdmin, async (req, res) => {
  try {
    const updated = await updateOne('staff', req.params.id, { canSelfCheckin: !!req.body.canSelfCheckin });
    if (!updated) return res.status(404).json({ error: 'Staff not found' });
    const { password: _, ...safe } = updated;
    res.json(safe);
  } catch (err) {
    console.error('[Tour toggle]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/staff/:id/gender — set staff gender (male/female)
router.patch('/:id/gender', attendanceManagerOrAdmin, async (req, res) => {
  try {
    const { gender } = req.body;
    if (!['male', 'female'].includes(gender)) {
      return res.status(400).json({ error: 'gender must be male or female' });
    }
    const updated = await updateOne('staff', req.params.id, { gender });
    if (!updated) return res.status(404).json({ error: 'Staff not found' });
    const { password: _, ...safe } = updated;
    res.json(safe);
  } catch (err) {
    console.error('[Gender set]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/staff/:id/face — clear face enrollment
router.delete('/:id/face', attendanceManagerOrAdmin, async (req, res) => {
  try {
    const updated = await updateOne('staff', req.params.id, { faceDescriptors: [] });
    if (!updated) return res.status(404).json({ error: 'Staff not found' });
    res.json({ message: 'Face enrollment cleared' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/staff/performance/all — all performance records in one read (avoids N+1)
// Must be declared before /:id/performance so "performance" isn't treated as an :id.
router.get('/performance/all', async (req, res) => {
  try {
    const perf = await readDB('performance');
    res.json(perf.sort((a, b) => a.week.localeCompare(b.week)));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/staff/:id/performance
router.get('/:id/performance', async (req, res) => {
  try {
    const perf = await readDB('performance');
    res.json(perf.filter(p => p.staffId === req.params.id).sort((a, b) => a.week.localeCompare(b.week)));
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
