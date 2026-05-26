/**
 * Attendance routes — JWT-protected.
 * POST /login  & POST /logout are called by the regular app login flow.
 * GET /today, GET /monthly, GET /staff/:id, GET+PATCH /config
 * are used by the admin + attendance_manager portal.
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB, updateOne } = require('../utils/db');
const { authMiddleware, attendanceManagerOrAdmin } = require('../middleware/auth');

const router = express.Router();

const todayStr = () => new Date().toISOString().split('T')[0];

// Recalculate total hours from all closed sessions in a record
function calcHours(sessions = []) {
  const mins = sessions
    .filter(s => s.loginAt && s.logoutAt)
    .reduce((sum, s) =>
      sum + (new Date(s.logoutAt).getTime() - new Date(s.loginAt).getTime()) / 60000, 0);
  return Math.round(mins * 100) / 100 / 60; // hours, 2 dp
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

// ── POST /api/attendance/login ────────────────────────────────────────────────
// Called from the frontend right after a successful auth login.
router.post('/login', authMiddleware, async (req, res) => {
  try {
    const now    = new Date().toISOString();
    const today  = todayStr();
    const records = await readDB('attendance');

    let record = records.find(r => r.staffId === req.user.id && r.date === today);

    if (!record) {
      record = {
        id: uuidv4(),
        staffId:   req.user.id,
        staffName: req.user.name,
        date:      today,
        loginAt:   now,
        logoutAt:  null,
        hoursWorked: 0,
        sessions:  [{ loginAt: now, logoutAt: null }],
      };
      records.push(record);
    } else {
      record.sessions = record.sessions || [];
      record.sessions.push({ loginAt: now, logoutAt: null });
    }

    await writeDB('attendance', records);
    res.json(record);
  } catch (err) {
    console.error('[Attendance login]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/attendance/logout ───────────────────────────────────────────────
// Called from the frontend just before clearing the auth token.
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const now     = new Date();
    const today   = todayStr();
    const records = await readDB('attendance');

    const record = records.find(r => r.staffId === req.user.id && r.date === today);
    if (!record) return res.json({ message: 'No open session found for today' });

    const sessions = record.sessions || [];
    const open = [...sessions].reverse().find(s => !s.logoutAt);
    if (open) {
      open.logoutAt = now.toISOString();
      open.hours = Math.round(
        (now - new Date(open.loginAt)) / 36000) / 100;
    }

    record.logoutAt    = now.toISOString();
    record.hoursWorked = calcHours(sessions);
    record.sessions    = sessions;

    await writeDB('attendance', records);
    res.json(record);
  } catch (err) {
    console.error('[Attendance logout]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/attendance ───────────────────────────────────────────────────────
// Admin sees all; staff sees own. Query: ?staffId=&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', authMiddleware, async (req, res) => {
  try {
    let records = await readDB('attendance');
    const { staffId, from, to } = req.query;

    if (req.user.role === 'staff') {
      records = records.filter(r => r.staffId === req.user.id);
    }
    if (staffId) records = records.filter(r => r.staffId === staffId);
    if (from)    records = records.filter(r => r.date >= from);
    if (to)      records = records.filter(r => r.date <= to);

    records.sort((a, b) => b.date.localeCompare(a.date));
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/attendance/config ────────────────────────────────────────────────
router.get('/config', authMiddleware, attendanceManagerOrAdmin, async (req, res) => {
  try {
    const cfg = await getAttendanceConfig();
    res.json(cfg);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/attendance/config ──────────────────────────────────────────────
router.patch('/config', authMiddleware, attendanceManagerOrAdmin, async (req, res) => {
  try {
    const updates = req.body;
    const configs = await readDB('config');
    const rec = configs.find(c => c.key === 'attendance');
    if (rec) {
      rec.value = { ...rec.value, ...updates };
      await writeDB('config', configs);
      res.json(rec.value);
    } else {
      // Create it
      const newRec = { id: 'attendance-config', key: 'attendance', value: { shiftStart: '09:30', shiftEnd: '18:30', lateGraceMins: 15, expectedHours: 9, kioskPin: '1234', ...updates } };
      configs.push(newRec);
      await writeDB('config', configs);
      res.json(newRec.value);
    }
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/attendance/today ─────────────────────────────────────────────────
// Today's status for all staff — who's in, out, or absent.
router.get('/today', authMiddleware, attendanceManagerOrAdmin, async (req, res) => {
  try {
    const today = todayStr();
    const [staff, attendance, leaves] = await Promise.all([
      readDB('staff'),
      readDB('attendance'),
      readDB('leaves').catch(() => []),
    ]);
    const todayRecs   = attendance.filter(r => r.date === today);
    const todayLeaves = leaves.filter(l => l.date === today);

    const result = staff
      .filter(s => s.active !== false)
      .map(s => {
        const rec = todayRecs.find(r => r.staffId === s.id);
        const openSession = rec?.sessions?.find(ss => !ss.logoutAt);
        const leaveRec = todayLeaves.find(l => l.staffId === s.id);
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
          faceEnrolled: !!(s.faceDescriptors?.length),
          leaveToday:  leaveRec ? { type: leaveRec.type, reason: leaveRec.reason } : null,
        };
      })
      .sort((a, b) => {
        // in → out → absent
        const order = { in: 0, out: 1, absent: 2 };
        return (order[a.status] ?? 3) - (order[b.status] ?? 3);
      });

    res.json(result);
  } catch (err) {
    console.error('[Attendance today]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/attendance/monthly ───────────────────────────────────────────────
// Query: ?month=YYYY-MM (defaults to current month)
// Returns per-staff summary with dailyMap, total hours, overtime, undertime, late count.
router.get('/monthly', authMiddleware, attendanceManagerOrAdmin, async (req, res) => {
  try {
    const cfg = await getAttendanceConfig();
    const expected = cfg.expectedHours || 9;

    // Determine month range
    const now = new Date();
    const monthStr = req.query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [yr, mo] = monthStr.split('-').map(Number);
    const fromDate = `${monthStr}-01`;
    const lastDay  = new Date(yr, mo, 0).getDate();
    const toDate   = `${monthStr}-${String(lastDay).padStart(2, '0')}`;

    const [staff, attendance] = await Promise.all([readDB('staff'), readDB('attendance')]);
    const monthRecs = attendance.filter(r => r.date >= fromDate && r.date <= toDate);

    // Build result per staff member
    const result = staff
      .filter(s => s.active !== false)
      .map(s => {
        const recs = monthRecs.filter(r => r.staffId === s.id);

        // dailyMap: { 'DD': 'present' | 'late' | 'absent' }
        const dailyMap = {};
        let totalHours  = 0;
        let presentDays = 0;
        let lateDays    = 0;

        for (let d = 1; d <= lastDay; d++) {
          const dd      = String(d).padStart(2, '0');
          const dateStr = `${monthStr}-${dd}`;
          const rec     = recs.find(r => r.date === dateStr);
          if (rec) {
            presentDays++;
            totalHours += rec.hoursWorked || 0;
            if (rec.isLate) { lateDays++; dailyMap[dd] = 'late'; }
            else             { dailyMap[dd] = 'present'; }
          } else {
            // Only mark absent for past/today, not future
            if (dateStr <= todayStr()) dailyMap[dd] = 'absent';
          }
        }

        const overtimeHours  = Math.max(0, Math.round((totalHours - expected * presentDays) * 100) / 100);
        const undertimeHours = Math.max(0, Math.round((expected * presentDays - totalHours) * 100) / 100);

        return {
          staffId:       s.id,
          staffName:     s.name,
          avatar:        s.avatar || s.name[0].toUpperCase(),
          faceEnrolled:  !!(s.faceDescriptors?.length),
          totalDays:     lastDay,
          presentDays,
          lateDays,
          absentDays:    Math.max(0, presentDays - lateDays),
          totalHours:    Math.round(totalHours * 100) / 100,
          overtimeHours,
          undertimeHours,
          dailyMap,
        };
      });

    res.json({ month: monthStr, expectedHours: expected, staff: result });
  } catch (err) {
    console.error('[Attendance monthly]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/attendance/staff/:id ────────────────────────────────────────────
// Individual staff attendance history. Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/staff/:id', authMiddleware, attendanceManagerOrAdmin, async (req, res) => {
  try {
    let records = await readDB('attendance');
    records = records.filter(r => r.staffId === req.params.id);
    const { from, to } = req.query;
    if (from) records = records.filter(r => r.date >= from);
    if (to)   records = records.filter(r => r.date <= to);
    records.sort((a, b) => b.date.localeCompare(a.date));
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
