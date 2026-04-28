const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/vendors
// Admin → all vendors.
// Staff → only vendors they have a vendorInteraction with.
//         If two staff share a vendor, both see it.
router.get('/', async (req, res) => {
  try {
    const vendors = await readDB('vendors');

    if (req.user.role === 'staff') {
      const vendorInteractions = await readDB('vendorInteractions');
      const myVendorIds = new Set(
        vendorInteractions
          .filter(vi => vi.staffId === req.user.id)
          .map(vi => vi.vendorId)
      );
      return res.json(vendors.filter(v => myVendorIds.has(v.id)));
    }

    res.json(vendors);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/vendors/:id
router.get('/:id', async (req, res) => {
  try {
    const vendors = await readDB('vendors');
    const v = vendors.find(x => x.id === req.params.id);
    if (!v) return res.status(404).json({ error: 'Vendor not found' });
    res.json(v);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/vendors (any authenticated user)
router.post('/', async (req, res) => {
  try {
    const { name, company, phone, email, category, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const vendor = {
      id: uuidv4(),
      name,
      company: company || '',
      phone: phone || '',
      email: email || '',
      category: category || 'General',
      status: 'active',
      notes: notes || '',
      createdAt: new Date().toISOString(),
    };

    await insertOne('vendors', vendor);
    res.status(201).json(vendor);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/vendors/:id
router.patch('/:id', adminOnly, async (req, res) => {
  try {
    const updated = await updateOne('vendors', req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: 'Vendor not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/vendors/:id/interactions — diary log entries for this vendor
router.get('/:id/interactions', async (req, res) => {
  try {
    const all = await readDB('vendorInteractions');
    const items = all
      .filter(x => x.vendorId === req.params.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/vendors/:id
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const deleted = await deleteOne('vendors', req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ message: 'Vendor deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
