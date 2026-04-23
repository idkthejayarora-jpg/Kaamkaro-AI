const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const todayStr = () => new Date().toISOString().split('T')[0];

// Recalculate total hours from all closed sessions in a record
function calcHours(sessions = []) {
  const mins = sessions
    .filter(s => s.loginAt && s.logoutAt)
    .reduce((sum, s) =>
      sum + (new Date(s.logoutAt).getTime() - new Date(s.loginAt).getTime()) / 60000, 0);
  return Math.round(mins * 100) / 100 / 60; // hours, 2 dp
}

// ── POST /api/attendance/login ────────────────────────────────────────────────
// Called from the frontend right after a successful auth login.
router.post('/login', async (req, res) => {
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
        loginAt:   now,        // first login of the day
        logoutAt:  null,
        hoursWorked: 0,
        sessions:  [{ loginAt: now, logoutAt: null }],
      };
      records.push(record);
    } else {
      // Already has a record for today — push a new session (re-login after logout)
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
router.post('/logout', async (req, res) => {
  try {
    const now     = new Date().toISOString();
    const today   = todayStr();
    const records = await readDB('attendance');

    const record = records.find(r => r.staffId === req.user.id && r.date === today);
    if (!record) return res.json({ message: 'No open session found for today' });

    // Close the most recent open session
    const sessions = record.sessions || [];
    const open = [...sessions].reverse().find(s => !s.logoutAt);
    if (open) {
      open.logoutAt = now;
      open.hours = Math.round(
        (new Date(now).getTime() - new Date(open.loginAt).getTime()) / 600) / 100; // hrs
    }

    record.logoutAt    = now;
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
router.get('/', async (req, res) => {
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

module.exports = router;
