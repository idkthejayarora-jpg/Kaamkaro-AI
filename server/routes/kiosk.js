/**
 * Kiosk routes — PIN-authenticated (no JWT required).
 * Used by the tablet attendance kiosk at the office entrance.
 *
 * All endpoints validate the X-Kiosk-Pin header against
 * the kioskPin stored in the attendance config record.
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB, withLock } = require('../utils/db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

const { istToday, istNowMinutes } = require('../utils/dates');
const todayStr = istToday;

// A face scan only counts as a CHECK-IN when it lands within this many minutes
// of the staff member's shift start. Past the window, a first scan of the day is
// treated as a check-out attempt — so a missed morning check-in can't be recorded
// as an evening "in-time".
const CHECKIN_WINDOW_MINS = 4 * 60; // 4 hours

// Effective shift start ("HH:MM") for a staff member:
// personal shiftOverride → gender-based shift → default config.
function effectiveShiftStart(member, cfg) {
  const genderShift = (member.gender === 'female' && cfg.womenShift) ? cfg.womenShift : null;
  const shift = member.shiftOverride || genderShift || cfg;
  return shift.shiftStart || cfg.shiftStart || '00:00';
}

async function getAttendanceConfig() {
  const config = await readDB('config').catch(() => []);
  const rec = config.find(c => c.key === 'attendance');
  return rec?.value || {
    shiftStart: '09:30',
    shiftEnd: '18:30',
    lateGraceMins: 15,
    expectedHours: 9,
    kioskPin: '1234',
  };
}

function calcHours(sessions = []) {
  const mins = sessions
    .filter(s => s.loginAt && s.logoutAt)
    .reduce((sum, s) =>
      sum + (new Date(s.logoutAt) - new Date(s.loginAt)) / 60000, 0);
  return Math.round(mins * 100) / 100 / 60;
}

// ── PIN brute-force protection ────────────────────────────────────────────────
// In-memory per-IP counter. Resets on server restart (acceptable for kiosk use).
// 3 wrong PINs in 5 min → 10 min lockout.
const PIN_MAX_FAILS    = 3;
const PIN_WINDOW_MS    = 5 * 60 * 1000;
const PIN_LOCKOUT_MS   = 10 * 60 * 1000;
const pinFailureMap    = new Map(); // ip → { fails: number, firstFailAt: ms, lockedUntil: ms }

function pinClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
}

function recordPinFailure(ip) {
  const now = Date.now();
  const rec = pinFailureMap.get(ip) || { fails: 0, firstFailAt: now, lockedUntil: 0 };
  // Reset window if first failure aged out
  if (now - rec.firstFailAt > PIN_WINDOW_MS) {
    rec.fails       = 0;
    rec.firstFailAt = now;
  }
  rec.fails += 1;
  if (rec.fails >= PIN_MAX_FAILS) {
    rec.lockedUntil = now + PIN_LOCKOUT_MS;
  }
  pinFailureMap.set(ip, rec);
}

function pinLockoutSecondsRemaining(ip) {
  const rec = pinFailureMap.get(ip);
  if (!rec || !rec.lockedUntil) return 0;
  const remaining = rec.lockedUntil - Date.now();
  if (remaining <= 0) {
    // Lockout expired — clear the slate
    pinFailureMap.delete(ip);
    return 0;
  }
  return Math.ceil(remaining / 1000);
}

// ── PIN middleware ─────────────────────────────────────────────────────────────
async function kioskPinMiddleware(req, res, next) {
  try {
    const ip = pinClientIp(req);
    const lockSecs = pinLockoutSecondsRemaining(ip);
    if (lockSecs > 0) {
      return res.status(429).json({
        error: `Too many wrong PINs. Try again in ${Math.ceil(lockSecs / 60)} min.`,
        lockedFor: lockSecs,
      });
    }

    const sentPin = req.headers['x-kiosk-pin'];
    if (!sentPin) return res.status(401).json({ error: 'Kiosk PIN required' });

    // Auto-unlock bypass: admin/manager opened kiosk from within the portal.
    // They send '__auto__' as the PIN; we verify their JWT instead of the kiosk PIN.
    if (sentPin === '__auto__') {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
          if (decoded.role === 'admin' || decoded.role === 'attendance_manager') {
            req.attendanceCfg = await getAttendanceConfig();
            return next();
          }
        } catch { /* invalid JWT — fall through to PIN check */ }
      }
      recordPinFailure(ip);
      return res.status(401).json({ error: 'Invalid kiosk PIN' });
    }

    const cfg = await getAttendanceConfig();
    if (sentPin !== String(cfg.kioskPin)) {
      recordPinFailure(ip);
      return res.status(401).json({ error: 'Invalid kiosk PIN' });
    }
    // Successful auth — clear any prior failures for this IP
    pinFailureMap.delete(ip);
    req.attendanceCfg = cfg;
    next();
  } catch (err) {
    console.error('[Kiosk PIN]', err);
    res.status(500).json({ error: 'Server error' });
  }
}

router.use(kioskPinMiddleware);

// ── GET /api/kiosk/descriptors ─────────────────────────────────────────────────
// Returns all active staff with their face descriptors.
// The kiosk uses this to do local (browser-side) face matching.
router.get('/descriptors', async (req, res) => {
  try {
    const staff = await readDB('staff');
    const active = staff
      .filter(s => s.active !== false && s.faceDescriptors?.length)
      .map(({ id, name, avatar, faceDescriptors }) => ({ id, name, avatar, faceDescriptors }));
    res.json(active);
  } catch (err) {
    console.error('[Kiosk descriptors]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/kiosk/today ──────────────────────────────────────────────────────
// Today's check-in status for all staff (for the kiosk status bar).
router.get('/today', async (req, res) => {
  try {
    const [staff, attendance] = await Promise.all([readDB('staff'), readDB('attendance')]);
    const today = todayStr();
    const todayRecs = attendance.filter(r => r.date === today);

    const result = staff
      .filter(s => s.active !== false)
      .map(s => {
        const rec = todayRecs.find(r => r.staffId === s.id);
        const openSession = rec?.sessions?.find(ss => !ss.logoutAt);
        return {
          staffId:     s.id,
          staffName:   s.name,
          avatar:      s.avatar || s.name[0].toUpperCase(),
          status:      rec ? (openSession ? 'in' : 'out') : 'absent',
          loginAt:     rec?.loginAt || null,
          logoutAt:    rec?.logoutAt || null,
          isLate:      rec?.isLate || false,
          lateMinutes: rec?.lateMinutes || 0,
          hoursWorked: rec?.hoursWorked || 0,
        };
      });

    res.json(result);
  } catch (err) {
    console.error('[Kiosk today]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/kiosk/checkin ───────────────────────────────────────────────────
// Body: { staffId }
// Creates or appends an attendance session. Calculates isLate / lateMinutes.
router.post('/checkin', async (req, res) => {
  try {
    const { staffId } = req.body;
    if (!staffId) return res.status(400).json({ error: 'staffId required' });

    const staff = await readDB('staff');
    const member = staff.find(s => s.id === staffId && s.active !== false);
    if (!member) return res.status(404).json({ error: 'Staff not found' });

    const now   = new Date();
    const today = todayStr();
    const cfg   = req.attendanceCfg;

    // Late calculation — priority: personal shiftOverride → gender-based shift → default
    const genderShift = (member.gender === 'female' && cfg.womenShift) ? cfg.womenShift : null;
    const effectiveShift = member.shiftOverride || genderShift || cfg;
    const [shiftH, shiftM] = effectiveShift.shiftStart.split(':').map(Number);
    const deadline = new Date(now);
    deadline.setHours(shiftH, shiftM + (cfg.lateGraceMins || 0), 0, 0);
    const isLate     = now > deadline;
    const lateMinutes = isLate ? Math.max(0, Math.round((now - deadline) / 60000)) : 0;

    // Serialised: read+mutate+write the attendance file atomically per collection
    const result = await withLock('attendance', async () => {
      const records = await readDB('attendance');
      let record = records.find(r => r.staffId === staffId && r.date === today);

      if (!record) {
        record = {
          id:          uuidv4(),
          staffId,
          staffName:   member.name,
          date:        today,
          loginAt:     now.toISOString(),
          logoutAt:    null,
          hoursWorked: 0,
          isLate,
          lateMinutes,
          sessions:    [{ loginAt: now.toISOString(), logoutAt: null }],
        };
        records.push(record);
      } else {
        // Re-entering (came back after stepping out)
        record.sessions = record.sessions || [];
        const alreadyOpen = record.sessions.some(s => !s.logoutAt);
        if (alreadyOpen) return { record, alreadyIn: true };
        record.sessions.push({ loginAt: now.toISOString(), logoutAt: null });
        // Keep original isLate from first login
      }

      await writeDB('attendance', records);
      return { record, alreadyIn: false };
    });

    if (result.alreadyIn) return res.json({ ...result.record, alreadyIn: true });

    // Sync availability — checked in = available (locked on staff collection)
    await withLock('staff', async () => {
      const staffList = await readDB('staff');
      const idx = staffList.findIndex(s => s.id === staffId);
      if (idx !== -1) { staffList[idx].availability = 'available'; await writeDB('staff', staffList); }
    });

    res.json(result.record);
  } catch (err) {
    console.error('[Kiosk checkin]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/kiosk/checkout ──────────────────────────────────────────────────
// Body: { staffId }
// Closes the open session and recalculates total hours.
router.post('/checkout', async (req, res) => {
  try {
    const { staffId } = req.body;
    if (!staffId) return res.status(400).json({ error: 'staffId required' });

    const now   = new Date();
    const today = todayStr();

    // Staff list read outside lock — used for shift lookup only (no mutation)
    const cfg = req.attendanceCfg;
    const staffListSnapshot = await readDB('staff');
    const staffMember = staffListSnapshot.find(s => s.id === staffId);

    // Serialised: read+mutate+write attendance atomically
    const result = await withLock('attendance', async () => {
      const records = await readDB('attendance');
      const record = records.find(r => r.staffId === staffId && r.date === today);
      if (!record) return { error: 'no_record' };

      const sessions = record.sessions || [];
      const open = [...sessions].reverse().find(s => !s.logoutAt);
      if (!open) return { record, alreadyOut: true };

      open.logoutAt = now.toISOString();
      open.hours    = Math.round((now - new Date(open.loginAt)) / 36000) / 100; // hrs, 2dp

      record.logoutAt    = now.toISOString();
      record.hoursWorked = calcHours(sessions);
      record.sessions    = sessions;

      // Overtime / undertime — priority: shiftOverride → gender shift → default
      let expected = cfg.expectedHours || 9;
      const genderShiftOut = (staffMember?.gender === 'female' && cfg.womenShift) ? cfg.womenShift : null;
      const effectiveShiftOut = staffMember?.shiftOverride || genderShiftOut;
      if (effectiveShiftOut) {
        const [sh, sm] = effectiveShiftOut.shiftStart.split(':').map(Number);
        const [eh, em] = effectiveShiftOut.shiftEnd.split(':').map(Number);
        expected = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
      }
      record.overtimeHours  = Math.max(0, Math.round((record.hoursWorked - expected) * 100) / 100);
      record.undertimeHours = Math.max(0, Math.round((expected - record.hoursWorked) * 100) / 100);

      await writeDB('attendance', records);
      return { record, alreadyOut: false };
    });

    if (result.error === 'no_record') return res.status(404).json({ error: 'No check-in found for today' });
    if (result.alreadyOut) return res.json({ ...result.record, alreadyOut: true });

    // Sync availability — checked out = out of office (locked on staff)
    await withLock('staff', async () => {
      const staffList = await readDB('staff');
      const sidx = staffList.findIndex(s => s.id === staffId);
      if (sidx !== -1) { staffList[sidx].availability = 'out_of_office'; await writeDB('staff', staffList); }
    });

    res.json(result.record);
  } catch (err) {
    console.error('[Kiosk checkout]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/kiosk/staff-list ──────────────────────────────────────────────────
// All active staff (id, name, avatar) — for enrollment dropdown
router.get('/staff-list', async (req, res) => {
  try {
    const staff = await readDB('staff');
    const list = staff
      .filter(s => s.active !== false)
      .map(({ id, name, avatar }) => ({ id, name, avatar: avatar || name[0].toUpperCase() }));
    res.json(list);
  } catch (err) {
    console.error('[Kiosk staff-list]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/kiosk/enroll ─────────────────────────────────────────────────────
// Link captured face descriptors (+ optional photo) to an existing staff member
// Body: { staffId, descriptors: number[][], facePhoto?: string (base64 JPEG) }
router.post('/enroll', async (req, res) => {
  try {
    const { staffId, descriptors, facePhoto } = req.body;
    if (!staffId || !Array.isArray(descriptors) || descriptors.length === 0)
      return res.status(400).json({ error: 'staffId and descriptors required' });

    const MAX_DESCRIPTORS = 25; // cap per staff — keeps matching fast + size bounded

    // Serialised read-modify-write so concurrent kiosk enrolls don't clobber.
    const result = await withLock('staff', async () => {
      const staff = await readDB('staff');
      const idx   = staff.findIndex(s => s.id === staffId);
      if (idx === -1) return { error: 'Staff not found' };

      // APPEND new descriptors to the existing set (don't overwrite) — every scan
      // becomes a fresh training sample, so recognition keeps improving over time.
      // Brand-new staff start empty, so this behaves like a plain enroll for them.
      const existing = Array.isArray(staff[idx].faceDescriptors) ? staff[idx].faceDescriptors : [];
      staff[idx].faceDescriptors = [...existing, ...descriptors].slice(-MAX_DESCRIPTORS);
      staff[idx].updatedAt = new Date().toISOString();

      // Save face photo only if one was provided (auto-learn sends none → keep old photo)
      if (facePhoto && typeof facePhoto === 'string' && facePhoto.startsWith('data:image')) {
        try {
          const fsExtra = require('fs-extra');
          const pathMod = require('path');
          const DATA_DIR = process.env.DATA_PATH
            ? pathMod.resolve(process.env.DATA_PATH)
            : pathMod.join(__dirname, '../data');
          const faceDir = pathMod.join(DATA_DIR, 'faces');
          await fsExtra.ensureDir(faceDir);
          const m = facePhoto.match(/^data:image\/\w+;base64,(.+)$/s);
          if (m) {
            await fsExtra.writeFile(pathMod.join(faceDir, `${staffId}.jpg`), Buffer.from(m[1], 'base64'));
            staff[idx].facePhoto   = `/api/staff/${staffId}/face-photo`;
            staff[idx].facePhotoAt = new Date().toISOString();
          }
        } catch (photoErr) {
          console.error('[Kiosk enroll photo]', photoErr.message);
        }
      }

      await writeDB('staff', staff);
      return { staff: staff[idx], count: staff[idx].faceDescriptors.length };
    });

    if (result.error) return res.status(404).json({ error: result.error });

    const { password: _, faceDescriptors: __, ...safe } = result.staff;
    console.log(`[Kiosk] Face enrolled for: ${result.staff.name} (${result.count} samples)`);
    res.json({ message: 'Face enrolled', staff: safe, sampleCount: result.count });
  } catch (err) {
    console.error('[Kiosk enroll]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/kiosk/quick-staff ────────────────────────────────────────────────
// Create a minimal staff record from the kiosk (name only required)
// Body: { name, phone? }
router.post('/quick-staff', async (req, res) => {
  try {
    const { v4: uuidv4 } = require('uuid');
    const bcrypt = require('bcryptjs');
    const { name, phone } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const autoPhone = phone?.trim() || `kiosk_${Date.now()}`;
    const hashed    = await bcrypt.hash(uuidv4(), 10); // random unguessable password
    const newStaff  = {
      id:           uuidv4(),
      name:         name.trim(),
      phone:        autoPhone,
      password:     hashed,
      role:         'staff',
      active:       true,
      avatar:       name.trim()[0].toUpperCase(),
      streakData:   { currentStreak: 0, lastActivityDate: null, longestStreak: 0 },
      createdAt:    new Date().toISOString(),
      kioskCreated: true,
    };

    // Uniqueness check + insert serialized under the staff lock so two concurrent
    // requests can't both pass the check and clobber each other's write.
    const result = await withLock('staff', async () => {
      const staff = await readDB('staff');
      if (phone?.trim()) {
        const [users, managers] = await Promise.all([readDB('users'), readDB('attendance_managers').catch(() => [])]);
        const taken = [...users, ...staff, ...managers].find(u => u.phone === phone.trim());
        if (taken) return { conflict: true };
      }
      staff.push(newStaff);
      await writeDB('staff', staff);
      return { conflict: false };
    });
    if (result.conflict) return res.status(409).json({ error: 'Phone number already in use' });

    const { password: _, ...safe } = newStaff;
    console.log(`[Kiosk] Quick staff created: ${newStaff.name}`);
    res.status(201).json(safe);
  } catch (err) {
    console.error('[Kiosk quick-staff]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
