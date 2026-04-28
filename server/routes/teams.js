const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/teams
// Admin: all teams. Staff: their own team only.
router.get('/', async (req, res) => {
  try {
    const teams = await readDB('teams');
    if (req.user.role === 'staff') {
      const myTeam = teams.find(t => Array.isArray(t.members) && t.members.includes(req.user.id));
      return res.json(myTeam ? [myTeam] : []);
    }
    res.json(teams);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/teams (admin only)
router.post('/', adminOnly, async (req, res) => {
  try {
    const { name, members = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Team name required' });

    // Ensure a staff member is in at most one team
    const existing = await readDB('teams');
    const inMembers = Array.isArray(members) ? members : [];

    const team = {
      id: uuidv4(),
      name: name.trim(),
      members: inMembers,
      pooledTasks: false,
      createdAt: new Date().toISOString(),
    };
    await insertOne('teams', team);
    res.status(201).json(team);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/teams/:id (admin only)
router.patch('/:id', adminOnly, async (req, res) => {
  try {
    const updates = {};
    if (req.body.name) updates.name = req.body.name.trim();
    if (Array.isArray(req.body.members)) updates.members = req.body.members;
    if (typeof req.body.pooledTasks === 'boolean') updates.pooledTasks = req.body.pooledTasks;
    const updated = await updateOne('teams', req.params.id, updates);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/teams/:id (admin only)
router.delete('/:id', adminOnly, async (req, res) => {
  try {
    const deleted = await deleteOne('teams', req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
