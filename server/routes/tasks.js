const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { broadcast } = require('../utils/sse');

const router = express.Router();
router.use(authMiddleware);

// GET /api/tasks
router.get('/', async (req, res) => {
  try {
    let tasks = await readDB('tasks');
    if (req.user.role === 'staff') {
      tasks = tasks.filter(t => t.staffId === req.user.id);
    }
    const { completed, staffId } = req.query;
    if (completed !== undefined) tasks = tasks.filter(t => t.completed === (completed === 'true'));
    if (staffId && req.user.role === 'admin') tasks = tasks.filter(t => t.staffId === staffId);
    tasks.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tasks
router.post('/', async (req, res) => {
  try {
    const { title, notes, dueDate, customerId, customerName, assignedTo } = req.body;
    if (!title || !dueDate) return res.status(400).json({ error: 'Title and dueDate required' });

    const staffId = (req.user.role === 'admin' && assignedTo) ? assignedTo : req.user.id;

    const task = {
      id: uuidv4(),
      staffId,
      customerId:   customerId || null,
      customerName: customerName || null,
      title,
      notes: notes || '',
      dueDate,
      completed: false,
      completedAt: null,
      createdAt: new Date().toISOString(),
    };

    await insertOne('tasks', task);
    await logAudit(req.user.id, req.user.name, 'create', 'task', task.id, `Task: ${title}`);
    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/tasks/:id/complete — mark done / undone
router.patch('/:id/complete', async (req, res) => {
  try {
    const tasks = await readDB('tasks');
    const t = tasks.find(x => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Task not found' });
    if (req.user.role === 'staff' && t.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const completed = !t.completed;
    const updated = await updateOne('tasks', req.params.id, {
      completed,
      completedAt: completed ? new Date().toISOString() : null,
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/tasks/:id — update task
router.patch('/:id', async (req, res) => {
  try {
    const tasks = await readDB('tasks');
    const t = tasks.find(x => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && t.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const updated = await updateOne('tasks', req.params.id, req.body);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', async (req, res) => {
  try {
    const tasks = await readDB('tasks');
    const t = tasks.find(x => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && t.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }
    await deleteOne('tasks', req.params.id);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
