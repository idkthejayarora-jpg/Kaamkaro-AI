/**
 * calendar.js — aggregated daily/monthly view across all activity types.
 *
 * GET /api/calendar/month?year=YYYY&month=MM[&staffId=xxx]
 *   → { days: { "YYYY-MM-DD": { tasks, diary, interactions, leads } } }
 *   dot counts per day — used to render indicators on the grid
 *
 * GET /api/calendar/day?date=YYYY-MM-DD[&staffId=xxx]
 *   → { tasks, diary, interactions, leads, attendance }
 *   full records for the selected day panel
 */

const express = require('express');
const { readDB } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── helpers ───────────────────────────────────────────────────────────────────

function toDateStr(iso) {
  if (!iso) return null;
  return iso.substring(0, 10); // "YYYY-MM-DD"
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate(); // month is 1-based → gives last day
}

// Resolve which staffId(s) to filter on
function resolveStaffFilter(req) {
  const { staffId } = req.query;
  if (req.user.role === 'admin') {
    return staffId || null; // null = all staff
  }
  return req.user.id; // staff always scoped to self
}

// ── GET /api/calendar/month ───────────────────────────────────────────────────
router.get('/month', async (req, res) => {
  try {
    const year  = parseInt(req.query.year,  10) || new Date().getFullYear();
    const month = parseInt(req.query.month, 10) || (new Date().getMonth() + 1);

    const filterStaffId = resolveStaffFilter(req);

    // Date range for this month  e.g. "2025-05-01" … "2025-05-31"
    const mm    = String(month).padStart(2, '0');
    const start = `${year}-${mm}-01`;
    const end   = `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, '0')}`;

    const [tasks, diary, interactions, leads] = await Promise.all([
      readDB('tasks').catch(() => []),
      readDB('diary').catch(() => []),
      readDB('interactions').catch(() => []),
      readDB('leads').catch(() => []),
    ]);

    // Build a map: date → counts
    const days = {};

    const bump = (dateStr, key) => {
      if (!dateStr || dateStr < start || dateStr > end) return;
      if (!days[dateStr]) days[dateStr] = { tasks: 0, diary: 0, interactions: 0, leads: 0 };
      days[dateStr][key]++;
    };

    // Tasks — count on dueDate (and completedAt if different day)
    tasks.forEach(t => {
      if (filterStaffId && t.staffId !== filterStaffId) return;
      bump(toDateStr(t.dueDate), 'tasks');
      if (t.completedAt && toDateStr(t.completedAt) !== toDateStr(t.dueDate)) {
        bump(toDateStr(t.completedAt), 'tasks');
      }
    });

    // Diary — count on entry date
    diary.forEach(d => {
      if (filterStaffId && d.staffId !== filterStaffId) return;
      bump(toDateStr(d.date || d.createdAt), 'diary');
    });

    // Interactions — count on createdAt
    interactions.forEach(i => {
      if (filterStaffId && i.staffId !== filterStaffId) return;
      bump(toDateStr(i.createdAt), 'interactions');
    });

    // Leads — count creation + stage-change-to-won date
    leads.forEach(l => {
      const assigneeId = l.staffId || l.assignedTo;
      if (filterStaffId && assigneeId !== filterStaffId) return;
      bump(toDateStr(l.createdAt), 'leads');
      if (l.stage === 'won' && l.updatedAt && toDateStr(l.updatedAt) !== toDateStr(l.createdAt)) {
        bump(toDateStr(l.updatedAt), 'leads');
      }
    });

    res.json({ year, month, days });
  } catch (err) {
    console.error('[Calendar/month]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/calendar/day ─────────────────────────────────────────────────────
router.get('/day', async (req, res) => {
  try {
    const { date } = req.query; // "YYYY-MM-DD"
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date param required (YYYY-MM-DD)' });
    }

    const filterStaffId = resolveStaffFilter(req);

    const [tasks, diary, interactions, leads, staff] = await Promise.all([
      readDB('tasks').catch(() => []),
      readDB('diary').catch(() => []),
      readDB('interactions').catch(() => []),
      readDB('leads').catch(() => []),
      readDB('staff').catch(() => []),
    ]);

    // Build a quick staff lookup for enrichment
    const staffMap = Object.fromEntries(staff.map(s => [s.id, s.name]));

    // Tasks: due on this date OR completed on this date
    const dayTasks = tasks.filter(t => {
      if (filterStaffId && t.staffId !== filterStaffId) return false;
      return toDateStr(t.dueDate) === date || toDateStr(t.completedAt) === date;
    }).map(t => ({
      ...t,
      staffName: t.staffName || staffMap[t.staffId] || 'Unknown',
      _type: 'task',
    }));

    // Diary: entry date
    const dayDiary = diary.filter(d => {
      if (filterStaffId && d.staffId !== filterStaffId) return false;
      return toDateStr(d.date || d.createdAt) === date;
    }).map(d => ({ ...d, _type: 'diary' }));

    // Interactions: createdAt date
    const dayInteractions = interactions.filter(i => {
      if (filterStaffId && i.staffId !== filterStaffId) return false;
      return toDateStr(i.createdAt) === date;
    }).map(i => ({
      ...i,
      staffName: i.staffName || staffMap[i.staffId] || 'Unknown',
      _type: 'interaction',
    }));

    // Leads: created or won on this date
    const dayLeads = leads.filter(l => {
      const assigneeId = l.staffId || l.assignedTo;
      if (filterStaffId && assigneeId !== filterStaffId) return false;
      return toDateStr(l.createdAt) === date || toDateStr(l.updatedAt) === date;
    }).map(l => ({
      ...l,
      staffName: l.staffName || staffMap[l.staffId || l.assignedTo] || 'Unknown',
      _type: 'lead',
    }));

    res.json({
      date,
      tasks:        dayTasks,
      diary:        dayDiary,
      interactions: dayInteractions,
      leads:        dayLeads,
    });
  } catch (err) {
    console.error('[Calendar/day]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
