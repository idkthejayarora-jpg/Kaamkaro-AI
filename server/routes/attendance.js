/**
 * Attendance routes — JWT-protected.
 * POST /login  & POST /logout are called by the regular app login flow.
 * GET /today, GET /monthly, GET /staff/:id, GET+PATCH /config
 * are used by the admin + attendance_manager portal.
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB, updateOne, withLock } = require('../utils/db');
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
    const nowDt  = new Date();
    const now    = nowDt.toISOString();
    const today  = todayStr();

    // Compute late status against the staff's effective shift (mirrors kiosk/manual/self-checkin)
    const [cfg, staffList] = await Promise.all([getAttendanceConfig(), readDB('staff')]);
    const member = staffList.find(s => s.id === req.user.id);
    let isLate = false, lateMinutes = 0;
    if (member) {
      const genderShift    = (member.gender === 'female' && cfg.womenShift) ? cfg.womenShift : null;
      const effectiveShift = member.shiftOverride || genderShift || cfg;
      const [shiftH, shiftM] = String(effectiveShift.shiftStart || '09:30').split(':').map(Number);
      if (!Number.isNaN(shiftH) && !Number.isNaN(shiftM)) {
        const deadline = new Date(nowDt);
        deadline.setHours(shiftH, shiftM + (cfg.lateGraceMins || 0), 0, 0);
        isLate      = nowDt > deadline;
        lateMinutes = isLate ? Math.max(0, Math.round((nowDt - deadline) / 60000)) : 0;
      }
    }

    const record = await withLock('attendance', async () => {
      const records = await readDB('attendance');
      let rec = records.find(r => r.staffId === req.user.id && r.date === today);

      if (!rec) {
        rec = {
          id: uuidv4(),
          staffId:   req.user.id,
          staffName: req.user.name,
          date:      today,
          loginAt:   now,
          logoutAt:  null,
          hoursWorked: 0,
          isLate,
          lateMinutes,
          sessions:  [{ loginAt: now, logoutAt: null }],
        };
        records.push(rec);
      } else {
        rec.sessions = rec.sessions || [];
        rec.sessions.push({ loginAt: now, logoutAt: null });
      }

      await writeDB('attendance', records);
      return rec;
    });

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

    const record = await withLock('attendance', async () => {
      const records = await readDB('attendance');
      const rec = records.find(r => r.staffId === req.user.id && r.date === today);
      if (!rec) return null;

      const sessions = rec.sessions || [];
      const open = [...sessions].reverse().find(s => !s.logoutAt);
      if (open) {
        open.logoutAt = now.toISOString();
        open.hours = Math.round((now - new Date(open.loginAt)) / 36000) / 100;
      }

      rec.logoutAt    = now.toISOString();
      rec.hoursWorked = calcHours(sessions);
      rec.sessions    = sessions;

      await writeDB('attendance', records);
      return rec;
    });

    if (!record) return res.json({ message: 'No open session found for today' });
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
router.get('/config', authMiddleware, async (req, res) => {
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
// Staff get their OWN row only; admins/managers get the whole team.
router.get('/monthly', authMiddleware, async (req, res) => {
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

    const [staff, attendance, allLeaves, holidays] = await Promise.all([
      readDB('staff'),
      readDB('attendance'),
      readDB('leaves').catch(() => []),
      readDB('holidays').catch(() => []),
    ]);
    const monthRecs   = attendance.filter(r => r.date >= fromDate && r.date <= toDate);
    const monthLeaves = allLeaves.filter(l => l.date >= fromDate && l.date <= toDate);
    const isDayOff    = makeDayOff(holidays); // Sundays + declared holidays (minus working overrides)

    // Helper: compute shift duration in hours from a shiftOverride or config
    function shiftDurationHours(override) {
      const [sh, sm] = override.shiftStart.split(':').map(Number);
      const [eh, em] = override.shiftEnd.split(':').map(Number);
      return ((eh * 60 + em) - (sh * 60 + sm)) / 60;
    }

    // Build result per staff member
    const result = staff
      .filter(s => s.active !== false)
      .map(s => {
        const recs   = monthRecs.filter(r => r.staffId === s.id);
        const leaves = monthLeaves.filter(l => l.staffId === s.id);

        // Per-staff effective expected hours — priority: shiftOverride → gender shift → default
        const genderShift = (s.gender === 'female' && cfg.womenShift) ? cfg.womenShift : null;
        const effectiveShift = s.shiftOverride || genderShift;
        const staffExpected = effectiveShift ? shiftDurationHours(effectiveShift) : expected;

        // dailyMap: { 'DD': 'present' | 'late' | 'absent' | 'leave' | 'sick' | 'half_day' }
        const dailyMap = {};
        let totalHours  = 0;
        let presentDays = 0;
        let lateDays    = 0;
        let leaveDays   = 0;
        let halfDays    = 0;
        let sickDays    = 0;
        let expectedTotal = 0; // accumulate only for days that aren't full leaves

        for (let d = 1; d <= lastDay; d++) {
          const dd      = String(d).padStart(2, '0');
          const dateStr = `${monthStr}-${dd}`;
          const rec     = recs.find(r => r.date === dateStr);
          const leave   = leaves.find(l => l.date === dateStr);

          if (rec) {
            presentDays++;
            totalHours    += rec.hoursWorked || 0;
            expectedTotal += staffExpected;
            if (rec.isLate) { lateDays++; dailyMap[dd] = 'late'; }
            else             { dailyMap[dd] = 'present'; }
          } else if (leave) {
            // Leave day — map type to cell label, adjust expected hours
            if (leave.type === 'sick') {
              sickDays++;
              dailyMap[dd] = 'sick';
              // Sick day: no undertime — don't add to expectedTotal
            } else if (leave.type === 'full_day' || leave.type === 'emergency') {
              leaveDays++;
              dailyMap[dd] = 'leave';
              // Full leave: no undertime
            } else if (leave.type === 'half_day_am' || leave.type === 'half_day_pm') {
              halfDays++;
              dailyMap[dd] = 'half_day';
              // Half day: expect only half the shift
              expectedTotal += staffExpected / 2;
            }
          } else if (isDayOff(dateStr)) {
            // Weekly off (Sunday) or declared holiday — never absent, no undertime.
            dailyMap[dd] = 'holiday';
          } else {
            // Only mark absent for past/today, not future
            if (dateStr <= todayStr()) {
              dailyMap[dd]   = 'absent';
              expectedTotal += staffExpected;
            }
          }
        }

        const overtimeHours  = Math.max(0, Math.round((totalHours - expectedTotal) * 100) / 100);
        const undertimeHours = Math.max(0, Math.round((expectedTotal - totalHours) * 100) / 100);

        return {
          staffId:       s.id,
          staffName:     s.name,
          avatar:        s.avatar || s.name[0].toUpperCase(),
          faceEnrolled:  !!(s.faceDescriptors?.length),
          shiftOverride: s.shiftOverride || null,
          totalDays:     lastDay,
          presentDays,
          lateDays,
          leaveDays,
          halfDays,
          sickDays,
          absentDays:    Object.values(dailyMap).filter(v => v === 'absent').length,
          totalHours:    Math.round(totalHours * 100) / 100,
          overtimeHours,
          undertimeHours,
          dailyMap,
        };
      });

    // Privacy: a plain staff member only ever sees their own summary row.
    const role = req.user?.role;
    const scoped = (role === 'admin' || role === 'attendance_manager')
      ? result
      : result.filter(r => r.staffId === req.user.id);

    res.json({ month: monthStr, expectedHours: expected, staff: scoped });
  } catch (err) {
    console.error('[Attendance monthly]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/attendance/staff/:id ────────────────────────────────────────────
// Individual staff attendance history. Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/staff/:id', authMiddleware, async (req, res) => {
  try {
    // Staff may read their OWN attendance; admins/managers may read anyone's.
    const role = req.user?.role;
    const isPrivileged = role === 'admin' || role === 'attendance_manager';
    if (!isPrivileged && req.params.id !== req.user.id) {
      return res.status(403).json({ error: 'You can only view your own attendance' });
    }
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

// ── GET /api/attendance/analytics ────────────────────────────────────────────
// Query: ?days=30
// Returns daily trend (present/late/absent per day) + totalStaff count.
router.get('/analytics', authMiddleware, attendanceManagerOrAdmin, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days) || 30));
    const [staff, attendance] = await Promise.all([
      readDB('staff'),
      readDB('attendance'),
    ]);

    const activeStaff = staff.filter(s => s.active !== false);
    const totalStaff  = activeStaff.length;

    const dailyTrend = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];

      const dayRecs = attendance.filter(r => r.date === dateStr);
      const present = dayRecs.length;
      const late    = dayRecs.filter(r => r.isLate).length;
      const absent  = Math.max(0, totalStaff - present);

      dailyTrend.push({ date: dateStr, present, late, absent });
    }

    res.json({ dailyTrend, totalStaff });
  } catch (err) {
    console.error('[Attendance analytics]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/attendance/manual ───────────────────────────────────────────────
// Body: { staffId, date, loginAt, logoutAt } — loginAt/logoutAt are HH:MM strings
router.post('/manual', authMiddleware, attendanceManagerOrAdmin, async (req, res) => {
  try {
    const { staffId, date, loginAt, logoutAt } = req.body;
    if (!staffId || !date) {
      return res.status(400).json({ error: 'staffId and date are required' });
    }

    // Reads outside lock — these don't mutate
    const [staffList, cfg] = await Promise.all([
      readDB('staff'),
      getAttendanceConfig(),
    ]);

    const staffMember = staffList.find(s => s.id === staffId);
    if (!staffMember) return res.status(404).json({ error: 'Staff not found' });

    const loginISO  = loginAt  ? `${date}T${loginAt}:00`  : null;
    const logoutISO = logoutAt ? `${date}T${logoutAt}:00` : null;

    let hoursWorked = 0;
    if (loginISO && logoutISO) {
      const diff = new Date(logoutISO).getTime() - new Date(loginISO).getTime();
      hoursWorked = Math.round(diff / 36000) / 100; // hours, 2dp
    }

    // Compute isLate against the staff's effective shift (mirrors kiosk.js)
    let isLate = false, lateMinutes = 0;
    if (loginISO) {
      const genderShift    = (staffMember.gender === 'female' && cfg.womenShift) ? cfg.womenShift : null;
      const effectiveShift = staffMember.shiftOverride || genderShift || cfg;
      const [shiftH, shiftM] = effectiveShift.shiftStart.split(':').map(Number);
      const loginDt  = new Date(loginISO);
      const deadline = new Date(loginDt);
      deadline.setHours(shiftH, shiftM + (cfg.lateGraceMins || 0), 0, 0);
      isLate      = loginDt > deadline;
      lateMinutes = isLate ? Math.max(0, Math.round((loginDt - deadline) / 60000)) : 0;
    }

    const { v4: uuidv4 } = require('uuid');

    // Serialised read-modify-write on attendance
    const record = await withLock('attendance', async () => {
      const records = await readDB('attendance');
      let rec = records.find(r => r.staffId === staffId && r.date === date);

      if (rec) {
        rec.loginAt        = loginISO;
        rec.logoutAt       = logoutISO;
        rec.hoursWorked    = hoursWorked;
        rec.sessions       = [{ loginAt: loginISO, logoutAt: logoutISO }];
        rec.manualOverride = true;
        rec.overriddenBy   = req.user.name;
        rec.isLate         = isLate;
        rec.lateMinutes    = lateMinutes;
      } else {
        rec = {
          id:             uuidv4(),
          staffId,
          staffName:      staffMember.name,
          date,
          loginAt:        loginISO,
          logoutAt:       logoutISO,
          hoursWorked,
          sessions:       [{ loginAt: loginISO, logoutAt: logoutISO }],
          manualOverride: true,
          overriddenBy:   req.user.name,
          isLate,
          lateMinutes,
        };
        records.push(rec);
      }

      await writeDB('attendance', records);
      return rec;
    });

    res.json(record);
  } catch (err) {
    console.error('[Attendance manual]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/attendance/self-checkin ─────────────────────────────────────────
// JWT auth only — no PIN. Staff on tour check themselves in after face verification.
// Guard: staff record must have canSelfCheckin: true.
router.post('/self-checkin', authMiddleware, async (req, res) => {
  try {
    const staffId = req.user.id;
    const cfg     = await getAttendanceConfig();
    const staffList = await readDB('staff');
    const member  = staffList.find(s => s.id === staffId);
    if (!member) return res.status(404).json({ error: 'Staff not found' });
    if (!member.canSelfCheckin) return res.status(403).json({ error: 'Self check-in not enabled for your account' });

    const now   = new Date();
    const today = todayStr();

    // Shift priority: personal override → gender-based shift → default
    const genderShift = (member.gender === 'female' && cfg.womenShift) ? cfg.womenShift : null;
    const effectiveShift = member.shiftOverride || genderShift || cfg;
    const [shiftH, shiftM] = effectiveShift.shiftStart.split(':').map(Number);
    const deadline = new Date(now);
    deadline.setHours(shiftH, shiftM + (cfg.lateGraceMins || 0), 0, 0);
    const isLate      = now > deadline;
    const lateMinutes = isLate ? Math.max(0, Math.round((now - deadline) / 60000)) : 0;

    const { record, alreadyIn } = await withLock('attendance', async () => {
      const records = await readDB('attendance');
      let rec = records.find(r => r.staffId === staffId && r.date === today);

      if (!rec) {
        rec = {
          id: require('uuid').v4(),
          staffId,
          staffName:   member.name,
          date:        today,
          loginAt:     now.toISOString(),
          logoutAt:    null,
          hoursWorked: 0,
          isLate,
          lateMinutes,
          selfCheckin: true,
          sessions:    [{ loginAt: now.toISOString(), logoutAt: null }],
        };
        records.push(rec);
      } else {
        const alreadyOpen = rec.sessions?.some(s => !s.logoutAt);
        if (alreadyOpen) return { record: rec, alreadyIn: true };
        rec.sessions = rec.sessions || [];
        rec.sessions.push({ loginAt: now.toISOString(), logoutAt: null });
      }

      await writeDB('attendance', records);
      return { record: rec, alreadyIn: false };
    });

    if (alreadyIn) return res.json({ ...record, alreadyIn: true });

    // Sync availability — serialised on staff to avoid clobbering concurrent staff writes
    await withLock('staff', async () => {
      const list = await readDB('staff');
      const idx = list.findIndex(s => s.id === staffId);
      if (idx !== -1) { list[idx].availability = 'available'; await writeDB('staff', list); }
    });

    res.json(record);
  } catch (err) {
    console.error('[Self checkin]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/attendance/self-checkout ────────────────────────────────────────
router.post('/self-checkout', authMiddleware, async (req, res) => {
  try {
    const staffId = req.user.id;
    const cfg     = await getAttendanceConfig();
    const staffList = await readDB('staff');
    const member  = staffList.find(s => s.id === staffId);
    if (!member) return res.status(404).json({ error: 'Staff not found' });
    if (!member.canSelfCheckin) return res.status(403).json({ error: 'Self check-in not enabled for your account' });

    const now   = new Date();
    const today = todayStr();

    // Expected hours — same priority as self-checkin
    const genderShift = (member.gender === 'female' && cfg.womenShift) ? cfg.womenShift : null;
    const effectiveShift = member.shiftOverride || genderShift;
    let expected = cfg.expectedHours || 9;
    if (effectiveShift) {
      const [sh, sm] = effectiveShift.shiftStart.split(':').map(Number);
      const [eh, em] = effectiveShift.shiftEnd.split(':').map(Number);
      expected = ((eh * 60 + em) - (sh * 60 + sm)) / 60;
    }

    const result = await withLock('attendance', async () => {
      const records = await readDB('attendance');
      const rec  = records.find(r => r.staffId === staffId && r.date === today);
      if (!rec) return { notFound: true };

      const sessions = rec.sessions || [];
      const open = [...sessions].reverse().find(s => !s.logoutAt);
      if (!open) return { record: rec, alreadyOut: true };

      open.logoutAt = now.toISOString();
      open.hours    = Math.round((now - new Date(open.loginAt)) / 36000) / 100;

      rec.logoutAt    = now.toISOString();
      rec.hoursWorked = calcHours(sessions);
      rec.sessions    = sessions;
      rec.overtimeHours  = Math.max(0, Math.round((rec.hoursWorked - expected) * 100) / 100);
      rec.undertimeHours = Math.max(0, Math.round((expected - rec.hoursWorked) * 100) / 100);

      await writeDB('attendance', records);
      return { record: rec };
    });

    if (result.notFound)   return res.status(404).json({ error: 'No check-in found for today' });
    if (result.alreadyOut) return res.json({ ...result.record, alreadyOut: true });

    // Sync availability — serialised on staff
    await withLock('staff', async () => {
      const list = await readDB('staff');
      const idx = list.findIndex(s => s.id === staffId);
      if (idx !== -1) { list[idx].availability = 'out_of_office'; await writeDB('staff', list); }
    });

    res.json(result.record);
  } catch (err) {
    console.error('[Self checkout]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
