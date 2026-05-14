const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// Default tags seeded on first request if the collection is empty
const DEFAULTS = [
  { name: 'Rakhi',     color: '#ef4444' },
  { name: 'Jewellery', color: '#C9A84C' },
  { name: 'Both',      color: '#10b981' },
  { name: 'Seasonal',  color: '#3b82f6' },
  { name: 'VIP',       color: '#a855f7' },
  { name: 'Bulk',      color: '#f59e0b' },
];

// GET /api/tag-defs — all authenticated users
router.get('/', async (req, res) => {
  try {
    let defs = await readDB('tagDefs');
    // Seed defaults once
    if (!defs || defs.length === 0) {
      const now = new Date().toISOString();
      for (const d of DEFAULTS) {
        const def = { id: uuidv4(), name: d.name, color: d.color, createdAt: now };
        await insertOne('tagDefs', def);
        defs.push(def);
      }
    }
    res.json(defs);
  } catch (err) {
    console.error('[TagDefs] GET error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tag-defs — admin only
router.post('/', adminOnly, async (req, res) => {
  try {
    const { name, color } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const def = {
      id:        uuidv4(),
      name:      name.trim(),
      color:     color || '#C9A84C',
      createdAt: new Date().toISOString(),
    };
    await insertOne('tagDefs', def);
    res.status(201).json(def);
  } catch (err) {
    console.error('[TagDefs] POST error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/tag-defs/:id — admin only (rename / recolor)
router.patch('/:id', adminOnly, async (req, res) => {
  try {
    const { name, color } = req.body;
    const updates = {};
    if (name?.trim()) updates.name  = name.trim();
    if (color)        updates.color = color;
    const updated = await updateOne('tagDefs', req.params.id, updates);
    if (!updated) return res.status(404).json({ error: 'Tag not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/tag-defs/:id — admin only
// Does NOT strip the tag name from existing customer/lead records
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    await deleteOne('tagDefs', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
