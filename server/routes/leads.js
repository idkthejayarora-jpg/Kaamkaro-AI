const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const { checkAndAwardBadges } = require('../utils/badgeEarner');

const router = express.Router();
router.use(authMiddleware);

// ── GET /api/leads ─────────────────────────────────────────────────────────────
// Staff: only their own leads.  Admin: all leads (optional ?staffId / ?teamId filter).
router.get('/', async (req, res) => {
  try {
    let leads = await readDB('leads');
    leads = leads.filter(l => l.isActive !== false);

    if (req.user.role === 'staff') {
      leads = leads.filter(l => l.staffId === req.user.id);
    } else {
      // Admin filters
      if (req.query.teamId) {
        // Filter by all staff members in a team
        const teams = await readDB('teams');
        const team  = teams.find(t => t.id === req.query.teamId);
        const memberIds = team?.members || [];
        leads = leads.filter(l => memberIds.includes(l.staffId));
      } else if (req.query.staffId) {
        leads = leads.filter(l => l.staffId === req.query.staffId);
      }
    }

    // Sort: nextFollowUp ASC (nulls last), then createdAt DESC
    leads.sort((a, b) => {
      const aDate = a.nextFollowUp || null;
      const bDate = b.nextFollowUp || null;
      if (aDate && bDate) return aDate.localeCompare(bDate);
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    // Attach staff name + team name for admin view
    if (req.user.role === 'admin') {
      try {
        const [staffList, teams] = await Promise.all([readDB('staff'), readDB('teams')]);
        const staffMap = Object.fromEntries(staffList.map(s => [s.id, s.name]));
        // Build staffId → teamName map
        const staffTeamMap = {};
        teams.forEach(t => (t.members || []).forEach(mid => { staffTeamMap[mid] = t.name; }));
        leads = leads.map(l => ({
          ...l,
          staffName: staffMap[l.staffId] || '',
          teamName:  staffTeamMap[l.staffId] || '',
        }));
      } catch {}
    }

    res.json(leads);
  } catch (err) {
    console.error('[Leads] GET error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/leads ────────────────────────────────────────────────────────────
// Creates a lead linked to an existing customer (customerId) OR a brand-new one.
// staffId defaults to req.user.id; admin can pass assignedTo to set a different owner.
router.post('/', async (req, res) => {
  try {
    const {
      name, phone = '', place = '', source = 'other',
      stage = 'new', nextFollowUp = null,
      visitDate = null, note = '',
      assignedTo,    // admin may specify a staff member
      customerId: existingCustomerId,  // if picking from customer DB
    } = req.body;

    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });

    // Determine owner
    const staffId = (req.user.role === 'admin' && assignedTo) ? assignedTo : req.user.id;

    const initialNotes = note?.trim()
      ? [{ text: note.trim(), date: new Date().toISOString() }]
      : [];

    let linkedCustomerId;

    if (existingCustomerId) {
      // ── Use existing customer — just update phone if it was missing ────────
      linkedCustomerId = existingCustomerId;
      const customers = await readDB('customers');
      const existing  = customers.find(c => c.id === existingCustomerId);
      if (existing && !existing.phone && phone?.trim()) {
        await updateOne('customers', existingCustomerId, { phone: phone.trim() });
      }
    } else {
      // ── Create a new customer record ────────────────────────────────────────
      linkedCustomerId = uuidv4();
      const customer = {
        id:            linkedCustomerId,
        name:          name.trim(),
        phone:         phone?.trim() || '',
        email:         '',
        assignedTo:    staffId,
        assignedStaff: [staffId],
        status:        'lead',
        lastContact:   null,
        notes:         note?.trim() || '',
        tags:          ['crm-lead'],
        dealValue:     null,
        createdAt:     new Date().toISOString(),
      };
      await insertOne('customers', customer);
    }

    // ── Create the lead record ─────────────────────────────────────────────────
    const lead = {
      id:               uuidv4(),
      staffId,
      linkedCustomerId,
      name:             name.trim(),
      phone:            phone?.trim() || '',
      place:            place?.trim() || '',
      source,
      stage,
      notes:            initialNotes,
      nextFollowUp:     nextFollowUp || null,
      visitDate:        visitDate || null,
      noPickupCount:    0,
      isActive:         true,
      createdAt:        new Date().toISOString(),
      updatedAt:        new Date().toISOString(),
    };
    await insertOne('leads', lead);

    res.status(201).json(lead);
  } catch (err) {
    console.error('[Leads] POST error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PUT /api/leads/:id ─────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const leads = await readDB('leads');
    const existing = leads.find(l => l.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    // Staff can only edit their own leads
    if (req.user.role === 'staff' && existing.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const allowed = ['name', 'phone', 'place', 'source', 'stage',
                     'notes', 'nextFollowUp', 'visitDate', 'noPickupCount', 'isActive'];
    const updates = { updatedAt: new Date().toISOString() };
    allowed.forEach(k => { if (k in req.body) updates[k] = req.body[k]; });

    // Keep the linked customer's name + phone in sync
    if ((updates.name || updates.phone) && existing.linkedCustomerId) {
      try {
        const custUpdates = {};
        if (updates.name)  custUpdates.name  = updates.name;
        if (updates.phone) custUpdates.phone = updates.phone;
        await updateOne('customers', existing.linkedCustomerId, custUpdates);
      } catch {}
    }

    const updated = await updateOne('leads', req.params.id, updates);

    // ── Badge check when stage advances to 'won' (non-blocking) ───────────────
    if (updates.stage === 'won' && existing.stage !== 'won') {
      const recipientId = existing.staffId || req.user.id;
      checkAndAwardBadges(recipientId, { event: 'lead_won' }).catch(() => {});
    }

    res.json(updated);
  } catch (err) {
    console.error('[Leads] PUT error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/leads/:id — soft delete ───────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const leads = await readDB('leads');
    const existing = leads.find(l => l.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    if (req.user.role === 'staff' && existing.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

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
