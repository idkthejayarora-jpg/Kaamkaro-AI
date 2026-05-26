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
const { readDB, writeDB } = require('../utils/db');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

const todayStr = () => new Date().toISOString().split('T')[0];

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

// ── PIN middleware ─────────────────────────────────────────────────────────────
async function kioskPinMiddleware(req, res, next) {
  try {
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
      return res.status(401).json({ error: 'Invalid kiosk PIN' });
    }

    const cfg = await getAttendanceConfig();
    if (sentPin !== String(cfg.kioskPin)) {
      return res.status(401).json({ error: 'Invalid kiosk PIN' });
    }
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

    // Late calculation — use per-staff shiftOverride if set, else global config
    const effectiveShift = member.shiftOverride || cfg;
    const [shiftH, shiftM] = effectiveShift.shiftStart.split(':').map(Number);
    const deadline = new Date(now);
    deadline.setHours(shiftH, shiftM + (cfg.lateGraceMins || 0), 0, 0);
    const isLate     = now > deadline;
    const lateMinutes = isLate ? Math.max(0, Math.round((now - deadline) / 60000)) : 0;

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
      if (alreadyOpen) {
        return res.json({ ...record, alreadyIn: true });
      }
      record.sessions.push({ loginAt: now.toISOString(), logoutAt: null });
      // Keep original isLate from first login
    }

    await writeDB('attendance', records);
    res.json(record);
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
    const records = await readDB('attendance');
    const record = records.find(r => r.staffId === staffId && r.date === today);

    if (!record) return res.status(404).json({ error: 'No check-in found for today' });

    const sessions = record.sessions || [];
    const open = [...sessions].reverse().find(s => !s.logoutAt);
    if (!open) return res.json({ ...record, alreadyOut: true });

    open.logoutAt = now.toISOString();
    open.hours    = Math.round((now - new Date(open.loginAt)) / 36000) / 100; // hrs, 2dp

    record.logoutAt    = now.toISOString();
    record.hoursWorked = calcHours(sessions);
    record.sessions    = sessions;

    // Overtime / undertime — use per-staff shift duration if override is set
    const cfg = req.attendanceCfg;
    const staffList = await readDB('staff');
    const staffMember = staffList.find(s => s.id === staffId);
    let expected = cfg.expectedHours || 9;
    if (staffMember?.shiftOverride) {
      const [sh, sm] = staffMember.shiftOverride.shiftStart.split(':').map(Number);
      const [eh, em] = staffMember.shiftOverride.shiftEnd.split(':').map(Number);
      expected = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
    }
    record.overtimeHours  = Math.max(0, Math.round((record.hoursWorked - expected) * 100) / 100);
    record.undertimeHours = Math.max(0, Math.round((expected - record.hoursWorked) * 100) / 100);

    await writeDB('attendance', records);
    res.json(record);
  } catch (err) {
    console.error('[Kiosk checkout]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
