const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { checkAndAwardBadges } = require('../utils/badgeEarner');
const { logAudit } = require('../utils/audit');

let Anthropic;
try { Anthropic = require('@anthropic-ai/sdk'); } catch {}

function getAI() {
  if (!Anthropic || !process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

const VALID_STAGES = ['new', 'contacted', 'interested', 'catalogue_sent', 'follow_up', 'visit_scheduled', 'won', 'lost'];
const VALID_SOURCES = ['walk_in', 'referral', 'phone', 'instagram', 'whatsapp', 'other'];

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

// ── POST /api/leads/bulk-import ────────────────────────────────────────────────
// Accepts array of { name, phone, place, source, stage }.
// Creates a lead + linked customer record for each row.
// Admin can pass assignedTo to import for a specific staff member; staff always imports for themselves.
router.post('/bulk-import', async (req, res) => {
  try {
    const { leads: incoming, assignedTo } = req.body;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return res.status(400).json({ error: 'No leads provided' });
    }
    // Staff can only import for themselves; admin may specify assignedTo
    const staffId = (req.user.role === 'admin' && assignedTo) ? assignedTo : req.user.id;
    const now = new Date().toISOString();
    const created = [];
    let skipped = 0;

    for (const row of incoming.slice(0, 500)) {
      if (!row.name?.trim()) { skipped++; continue; }

      const linkedCustomerId = uuidv4();
      const customer = {
        id:            linkedCustomerId,
        name:          row.name.trim(),
        phone:         row.phone?.trim() || '',
        email:         '',
        assignedTo:    staffId,
        assignedStaff: [staffId],
        status:        'lead',
        lastContact:   null,
        notes:         '',
        tags:          ['crm-lead', 'bulk-import'],
        dealValue:     null,
        createdAt:     now,
      };
      await insertOne('customers', customer);

      const lead = {
        id:               uuidv4(),
        staffId,
        linkedCustomerId,
        name:             row.name.trim(),
        phone:            row.phone?.trim() || '',
        place:            row.place?.trim() || '',
        source:           VALID_SOURCES.includes(row.source) ? row.source : 'other',
        stage:            VALID_STAGES.includes(row.stage)   ? row.stage  : 'new',
        notes:            [],
        nextFollowUp:     null,
        visitDate:        null,
        noPickupCount:    0,
        isActive:         true,
        createdAt:        now,
        updatedAt:        now,
      };
      await insertOne('leads', lead);
      created.push(lead);
    }

    await logAudit(req.user.id, req.user.name, 'create', 'lead', null,
      `Bulk imported ${created.length} leads (${skipped} skipped)`);

    res.status(201).json({ imported: created.length, skipped, leads: created });
  } catch (err) {
    console.error('[Leads] bulk-import error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/leads/bulk-actions ───────────────────────────────────────────────
// Actions: assign | stage | followup | delete
// Staff can only act on their own leads; assign action is admin-only.
router.post('/bulk-actions', async (req, res) => {
  try {
    const { ids, action, value } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }

    // Staff ownership guard: filter ids to only their own leads
    let allowedIds = ids;
    if (req.user.role === 'staff') {
      const allLeads = await readDB('leads');
      allowedIds = ids.filter(id => {
        const lead = allLeads.find(l => l.id === id);
        return lead && lead.staffId === req.user.id;
      });
    }

    let updated = 0;

    if (action === 'assign') {
      if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only admins can reassign leads' });
      }
      for (const id of allowedIds) {
        await updateOne('leads', id, { staffId: value, updatedAt: new Date().toISOString() });
        updated++;
      }
      await logAudit(req.user.id, req.user.name, 'update', 'lead', null,
        `Bulk assigned ${updated} leads to staff ${value}`);

    } else if (action === 'stage') {
      if (!VALID_STAGES.includes(value)) return res.status(400).json({ error: 'Invalid stage' });
      for (const id of allowedIds) {
        await updateOne('leads', id, { stage: value, updatedAt: new Date().toISOString() });
        updated++;
      }
      await logAudit(req.user.id, req.user.name, 'update', 'lead', null,
        `Bulk stage → ${value} for ${updated} leads`);

    } else if (action === 'followup') {
      for (const id of allowedIds) {
        await updateOne('leads', id, { nextFollowUp: value || null, updatedAt: new Date().toISOString() });
        updated++;
      }
      await logAudit(req.user.id, req.user.name, 'update', 'lead', null,
        `Bulk follow-up set to ${value} for ${updated} leads`);

    } else if (action === 'delete') {
      for (const id of allowedIds) {
        await updateOne('leads', id, { isActive: false, updatedAt: new Date().toISOString() });
        updated++;
      }
      await logAudit(req.user.id, req.user.name, 'delete', 'lead', null,
        `Bulk soft-deleted ${updated} leads`);

    } else {
      return res.status(400).json({ error: 'action must be assign, stage, followup, or delete' });
    }

    res.json({ updated });
  } catch (err) {
    console.error('[Leads] bulk-actions error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/leads/parse-text ─────────────────────────────────────────────────
// Admin-only. Uses Claude to extract contacts from any pasted raw text.
router.post('/parse-text', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text is required' });

    const ai = getAI();
    if (!ai) return res.status(503).json({ error: 'AI not configured' });

    const message = await ai.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Extract all contacts from the text below. Return ONLY a valid JSON array (no markdown, no commentary) with objects: {"name": string, "phone": string, "place": string}.
Rules:
- name: person or business name (required — skip if missing)
- phone: digits only, no spaces/dashes/+91 prefix. Empty string if not found.
- place: city or area name. Empty string if not found.
- One object per unique contact.

Text:
${text.trim()}`,
      }],
    });

    const raw = message.content[0]?.text?.trim() || '[]';
    // Strip markdown code fences if present
    const jsonStr = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();
    let leads;
    try {
      leads = JSON.parse(jsonStr);
      if (!Array.isArray(leads)) leads = [];
    } catch {
      leads = [];
    }

    // Sanitise
    leads = leads
      .filter(l => l && l.name?.trim())
      .map(l => ({
        name:  String(l.name  || '').trim(),
        phone: String(l.phone || '').replace(/\D/g, ''),
        place: String(l.place || '').trim(),
      }));

    res.json({ leads });
  } catch (err) {
    console.error('[Leads] parse-text error:', err);
    res.status(500).json({ error: 'Failed to parse text' });
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

    // If the linked customer has no other active leads, delete the customer too
    if (existing.linkedCustomerId) {
      try {
        const remainingActiveLeads = leads.filter(
          l => l.id !== req.params.id &&
               l.linkedCustomerId === existing.linkedCustomerId &&
               l.isActive !== false
        );
        if (remainingActiveLeads.length === 0) {
          const { deleteOne: delOne } = require('../utils/db');
          await delOne('customers', existing.linkedCustomerId);
        }
      } catch { /* non-blocking */ }
    }

    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('[Leads] DELETE error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
