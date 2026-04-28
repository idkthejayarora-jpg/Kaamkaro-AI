const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── GET /api/leads
// Returns all active leads, sorted nextFollowUp ASC (nulls last), then createdAt DESC
router.get('/', async (req, res) => {
  try {
    let leads = await readDB('leads');
    leads = leads.filter(l => l.isActive !== false);

    // Sort: nextFollowUp ASC (nulls last), then createdAt DESC
    leads.sort((a, b) => {
      const aDate = a.nextFollowUp || null;
      const bDate = b.nextFollowUp || null;
      if (aDate && bDate) return aDate.localeCompare(bDate);
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;
      // Both null — sort by createdAt DESC
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    res.json(leads);
  } catch (err) {
    console.error('[Leads] GET error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/leads
// Create a new lead (name required)
router.post('/', async (req, res) => {
  try {
    const {
      name, phone = '', place = '', source = 'other',
      stage = 'new', notes = [], nextFollowUp = null,
      visitDate = null, note = '',
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    const initialNotes = note?.trim()
      ? [{ text: note.trim(), date: new Date().toISOString() }]
      : (Array.isArray(notes) ? notes : []);

    const lead = {
      id:            uuidv4(),
      name:          name.trim(),
      phone:         phone?.trim() || '',
      place:         place?.trim() || '',
      source,
      stage,
      notes:         initialNotes,
      nextFollowUp:  nextFollowUp || null,
      visitDate:     visitDate || null,
      noPickupCount: 0,
      isActive:      true,
      createdAt:     new Date().toISOString(),
      updatedAt:     new Date().toISOString(),
    };

    await insertOne('leads', lead);
    res.status(201).json(lead);
  } catch (err) {
    console.error('[Leads] POST error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/leads/:id
// Update any fields on a lead
router.put('/:id', async (req, res) => {
  try {
    const leads = await readDB('leads');
    const existing = leads.find(l => l.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    const allowed = ['name', 'phone', 'place', 'source', 'stage',
                     'notes', 'nextFollowUp', 'visitDate', 'noPickupCount', 'isActive'];
    const updates = { updatedAt: new Date().toISOString() };
    allowed.forEach(k => {
      if (k in req.body) updates[k] = req.body[k];
    });

    const updated = await updateOne('leads', req.params.id, updates);
    res.json(updated);
  } catch (err) {
    console.error('[Leads] PUT error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/leads/:id — soft delete
router.delete('/:id', async (req, res) => {
  try {
    const updated = await updateOne('leads', req.params.id, {
      isActive: false,
      updatedAt: new Date().toISOString(),
    });
    if (!updated) return res.status(404).json({ error: 'Lead not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('[Leads] DELETE error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
