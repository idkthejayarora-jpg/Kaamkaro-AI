/**
 * Holidays — declared days off, and "working-day" overrides that open an
 * otherwise-off day (e.g. a Sunday during high season).
 *
 * Reads are open to any authenticated user (staff calendars show offs);
 * writes are admin / attendance-manager only.
 *
 * Record: { id, date: 'YYYY-MM-DD', label, type: 'holiday' | 'working', createdBy, createdAt }
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB, withLock } = require('../utils/db');
const { authMiddleware, attendanceManagerOrAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/holidays  (optional ?month=YYYY-MM)
router.get('/', async (req, res) => {
  try {
    let holidays = await readDB('holidays').catch(() => []);
    if (req.query.month) holidays = holidays.filter(h => h.date.startsWith(req.query.month));
    holidays.sort((a, b) => a.date.localeCompare(b.date));
    res.json(holidays);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/holidays  — body { date, label?, type? }
// type 'holiday' (default) = declared day off; 'working' = open an off-day.
router.post('/', attendanceManagerOrAdmin, async (req, res) => {
  try {
    const { date, label, type } = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const t = type === 'working' ? 'working' : 'holiday';
    const record = await withLock('holidays', async () => {
      const holidays = await readDB('holidays').catch(() => []);
      // One entry per date — replace any existing so toggling is clean.
      const next = holidays.filter(h => h.date !== date);
      const rec = {
        id:        uuidv4(),
        date,
        label:     (label || '').trim() || (t === 'working' ? 'Working day' : 'Holiday'),
        type:      t,
        createdBy: req.user.name,
        createdAt: new Date().toISOString(),
      };
      next.push(rec);
      await writeDB('holidays', next);
      return rec;
    });
    res.status(201).json(record);
  } catch (err) {
    console.error('[Holidays POST]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/holidays/:id
router.delete('/:id', attendanceManagerOrAdmin, async (req, res) => {
  try {
    const removed = await withLock('holidays', async () => {
      const holidays = await readDB('holidays').catch(() => []);
      const idx = holidays.findIndex(h => h.id === req.params.id);
      if (idx === -1) return false;
      holidays.splice(idx, 1);
      await writeDB('holidays', holidays);
      return true;
    });
    if (!removed) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Removed' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
