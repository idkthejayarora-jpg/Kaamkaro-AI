const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { calcHealthScore, healthLabel } = require('../utils/healthScore');
const { broadcast } = require('../utils/sse');
const { awardMerit } = require('../utils/merits');

const router = express.Router();
router.use(authMiddleware);

const PIPELINE_STAGES = ['lead', 'contacted', 'interested', 'negotiating', 'closed', 'churned'];

// Helper: check if a staff member has access to a customer
// A customer is accessible if: assignedTo === staffId  OR staffId is in assignedStaff[]
function staffCanAccess(customer, staffId) {
  if (customer.assignedTo === staffId) return true;
  return Array.isArray(customer.assignedStaff) && customer.assignedStaff.includes(staffId);
}

// GET /api/customers
router.get('/', async (req, res) => {
  try {
    let customers = await readDB('customers');
    if (req.user.role === 'staff') {
      customers = customers.filter(c => staffCanAccess(c, req.user.id));
    }
    // Attach health score
    const interactions = await readDB('interactions');
    customers = customers.map(c => {
      const score = calcHealthScore(c, interactions);
      const health = healthLabel(score);
      return { ...c, healthScore: score, healthLabel: health.label, healthColor: health.color };
    });
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/customers/:id
router.get('/:id', async (req, res) => {
  try {
    const customers = await readDB('customers');
    const c = customers.find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && c.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const interactions = await readDB('interactions');
    const score = calcHealthScore(c, interactions);
    const health = healthLabel(score);
    res.json({ ...c, healthScore: score, healthLabel: health.label, healthColor: health.color });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/customers — single create (admin OR staff)
router.post('/', async (req, res) => {
  try {
    const { name, phone, email, status, notes, tags, dealValue } = req.body;
    let { assignedTo } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });

    // Staff can only create customers assigned to themselves
    if (req.user.role === 'staff') {
      assignedTo = req.user.id;
    }

    const validStatus = PIPELINE_STAGES.includes(status) ? status : 'lead';
    const customer = {
      id: uuidv4(), name, phone: phone || '', email: email || '',
      assignedTo: assignedTo || null, status: validStatus,
      lastContact: null, notes: notes || '', tags: tags || [],
      dealValue: dealValue ? Number(dealValue) : null,
      createdAt: new Date().toISOString(),
    };
    await insertOne('customers', customer);
    await logAudit(req.user.id, req.user.name, 'create', 'customer', customer.id, `Created: ${name}`);
    res.status(201).json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/customers/bulk-import — CSV import (admin)
router.post('/bulk-import', adminOnly, async (req, res) => {
  try {
    const { customers: incoming } = req.body;
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return res.status(400).json({ error: 'No customers provided' });
    }
    const created = [];
    for (const row of incoming.slice(0, 500)) {
      if (!row.name) continue;
      const customer = {
        id: uuidv4(), name: row.name, phone: row.phone || '',
        email: row.email || '', assignedTo: row.assignedTo || null,
        status: PIPELINE_STAGES.includes(row.status) ? row.status : 'lead',
        lastContact: null, notes: row.notes || '', tags: [],
        dealValue: row.dealValue ? Number(row.dealValue) : null,
        createdAt: new Date().toISOString(),
      };
      await insertOne('customers', customer);
      created.push(customer);
    }
    await logAudit(req.user.id, req.user.name, 'create', 'customer', null, `Bulk imported ${created.length} customers`);
    res.status(201).json({ imported: created.length, customers: created });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/customers/bulk-actions — bulk assign/stage/delete (admin)
router.post('/bulk-actions', adminOnly, async (req, res) => {
  try {
    const { ids, action, value } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array required' });
    }
    let updated = 0;
    if (action === 'assign') {
      for (const id of ids) {
        await updateOne('customers', id, { assignedTo: value || null });
        updated++;
      }
      await logAudit(req.user.id, req.user.name, 'update', 'customer', null, `Bulk assigned ${updated} customers to staff ${value}`);
    } else if (action === 'stage') {
      if (!PIPELINE_STAGES.includes(value)) return res.status(400).json({ error: 'Invalid stage' });
      for (const id of ids) {
        await updateOne('customers', id, { status: value });
        updated++;
      }
      await logAudit(req.user.id, req.user.name, 'update', 'customer', null, `Bulk stage change to ${value} for ${updated} customers`);
    } else if (action === 'delete') {
      for (const id of ids) {
        await deleteOne('customers', id);
        updated++;
      }
      await logAudit(req.user.id, req.user.name, 'delete', 'customer', null, `Bulk deleted ${updated} customers`);
    } else {
      return res.status(400).json({ error: 'action must be assign, stage, or delete' });
    }
    res.json({ updated });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/customers/:id
router.patch('/:id', async (req, res) => {
  try {
    if (req.user.role === 'staff') {
      const customers = await readDB('customers');
      const c = customers.find(x => x.id === req.params.id);
      if (!c || c.assignedTo !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    }
    const customers = await readDB('customers');
    const existing  = customers.find(x => x.id === req.params.id);

    const updates = { ...req.body };
    if (updates.status && !PIPELINE_STAGES.includes(updates.status)) delete updates.status;
    if (updates.dealValue !== undefined) updates.dealValue = Number(updates.dealValue) || null;
    // Only admins may rename a customer
    if (req.user.role === 'staff') delete updates.name;
    const updated = await updateOne('customers', req.params.id, updates);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    broadcast('customer:updated', updated);

    // ── Merit: +5 for positive customer conversion ────────────────────────────
    if (existing && updates.status && updates.status !== existing.status) {
      const isConversion = updates.status === 'closed';
      // Also detect if a previously churned/inactive customer is being revived (closed from churned)
      const isRevival    = existing.status === 'churned' && updates.status !== 'churned' && updates.status !== 'lead';
      if (isConversion || isRevival) {
        const staffId   = existing.assignedTo || req.user.id;
        const staffList = await readDB('staff');
        const staff     = staffList.find(s => s.id === staffId);
        const staffName = staff?.name || req.user.name;
        const reason    = isRevival
          ? `Customer revived: ${existing.name}`
          : `Customer closed/converted: ${existing.name}`;
        await awardMerit(staffId, staffName, 5, reason, 'conversion', existing.id);
      }
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/customers/:id/notes — append a timestamped note
router.post('/:id/notes', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Text required' });
    const customers = await readDB('customers');
    const c = customers.find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && c.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const note = {
      id: uuidv4(), text: text.trim(),
      createdBy: req.user.name,
      createdAt: new Date().toISOString(),
    };
    const notesList = Array.isArray(c.notesList) ? [...c.notesList, note] : [note];
    await updateOne('customers', req.params.id, { notesList });
    res.status(201).json(note);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/customers/:id/notes/:noteId — remove a specific note
router.delete('/:id/notes/:noteId', async (req, res) => {
  try {
    const customers = await readDB('customers');
    const c = customers.find(x => x.id === req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && c.assignedTo !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const notesList = (c.notesList || []).filter(n => n.id !== req.params.noteId);
    await updateOne('customers', req.params.id, { notesList });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/customers/:id
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const deleted = await deleteOne('customers', req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    await logAudit(req.user.id, req.user.name, 'delete', 'customer', req.params.id, 'Customer deleted');
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
