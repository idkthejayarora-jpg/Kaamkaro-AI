const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const { updateStaffStreak } = require('../utils/streak');
const { logAudit } = require('../utils/audit');

const router = express.Router();
router.use(authMiddleware);

// GET /api/interactions?customerId=&staffId=
router.get('/', async (req, res) => {
  try {
    let interactions = await readDB('interactions');
    const { customerId, staffId } = req.query;

    if (req.user.role === 'staff') {
      if (customerId) {
        // Staff viewing a specific customer's profile: show ALL staff interactions
        // for that customer (full history visible to anyone who can access the customer)
        const customers = await readDB('customers');
        const cust = customers.find(c => c.id === customerId);
        if (!cust || cust.assignedTo !== req.user.id) {
          // Customer not assigned to this staff — restrict to own interactions only
          interactions = interactions.filter(i => i.staffId === req.user.id);
        }
        // else: customer is assigned to them → they see all interactions for that customer
      } else {
        // No customerId filter — staff only sees their own interactions list
        interactions = interactions.filter(i => i.staffId === req.user.id);
      }
    }

    if (customerId) interactions = interactions.filter(i => i.customerId === customerId);
    if (staffId)   interactions = interactions.filter(i => i.staffId === staffId);

    interactions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(interactions);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/interactions — log a contact interaction
router.post('/', async (req, res) => {
  try {
    const {
      customerId, type = 'call', responded = false,
      notes = '', followUpDate = null, followUpTitle = null,
    } = req.body;

    if (!customerId) return res.status(400).json({ error: 'customerId required' });

    // Verify staff has access to this customer
    if (req.user.role === 'staff') {
      const customers = await readDB('customers');
      const c = customers.find(x => x.id === customerId);
      if (!c || c.assignedTo !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const interaction = {
      id: uuidv4(),
      customerId,
      staffId: req.user.id,
      staffName: req.user.name,
      type,
      responded: Boolean(responded),
      notes,
      followUpDate: followUpDate || null,
      createdAt: new Date().toISOString(),
    };

    await insertOne('interactions', interaction);

    // Update customer's lastContact
    await updateOne('customers', customerId, { lastContact: new Date().toISOString() });

    // Auto-update streak and weekly performance
    await updateStaffStreak(req.user.id);

    // Auto-create a follow-up task if followUpDate is set
    if (followUpDate) {
      const customers = await readDB('customers');
      const c = customers.find(x => x.id === customerId);
      await insertOne('tasks', {
        id: uuidv4(),
        staffId: req.user.id,
        customerId,
        customerName: c?.name || 'Unknown',
        title: followUpTitle || `Follow up with ${c?.name || 'customer'}`,
        notes,
        dueDate: followUpDate,
        completed: false,
        completedAt: null,
        createdAt: new Date().toISOString(),
      });
    }

    await logAudit(req.user.id, req.user.name, 'create', 'interaction', interaction.id,
      `Logged ${type} with customer ${customerId}. Responded: ${responded}`);

    res.status(201).json(interaction);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/interactions/:id (admin only or own)
router.delete('/:id', async (req, res) => {
  try {
    const interactions = await readDB('interactions');
    const i = interactions.find(x => x.id === req.params.id);
    if (!i) return res.status(404).json({ error: 'Not found' });
    if (req.user.role !== 'admin' && i.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await deleteOne('interactions', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
