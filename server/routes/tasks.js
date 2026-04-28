const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const { logAudit } = require('../utils/audit');
const { broadcast } = require('../utils/sse');
const { awardMerit } = require('../utils/merits');

const router = express.Router();
router.use(authMiddleware);

// GET /api/tasks
router.get('/', async (req, res) => {
  try {
    let tasks = await readDB('tasks');
    if (req.user.role === 'staff') {
      // Find if this staff is in a team with pooledTasks enabled
      let pooledTeamId = null;
      try {
        const teams = await readDB('teams');
        const myTeam = teams.find(t => Array.isArray(t.members) && t.members.includes(req.user.id));
        if (myTeam?.pooledTasks === true) pooledTeamId = myTeam.id;
      } catch {}

      tasks = tasks.filter(t =>
        t.staffId === req.user.id ||                                      // own tasks (any status)
        (pooledTeamId && t.teamId === pooledTeamId && !t.completed)       // team pool (only pending)
      );
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
    broadcast('task:created', task);
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
    const completed   = !t.completed;
    const completedAt = completed ? new Date().toISOString() : null;
    const updated = await updateOne('tasks', req.params.id, { completed, completedAt });
    broadcast('task:updated', updated);

    // ── Merit points ──────────────────────────────────────────────────────────
    if (completed) {
      const staff = (await readDB('staff')).find(s => s.id === t.staffId)
                    || await readDB('users').then(u => u.find(u => u.id === t.staffId)).catch(() => null);
      const staffName = staff?.name || req.user.name;
      const today     = new Date().toISOString().split('T')[0];
      const isLate    = t.dueDate && t.dueDate < today;

      if (isLate) {
        // -1 for late, but still +1 for completing — net 0, but two separate events for transparency
        await awardMerit(t.staffId, staffName, -1, `Late completion: ${t.title}`, 'overdue', t.id);
      }
      await awardMerit(t.staffId, staffName, 1, `Task completed: ${t.title}`, 'task', t.id);
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/tasks/:id — update task (title, notes, dueDate)
// Rescheduling (dueDate change) costs -0.5 merit points.
router.patch('/:id', async (req, res) => {
  try {
    const tasks = await readDB('tasks');
    const t = tasks.find(x => x.id === req.params.id);
    if (!t) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'staff' && t.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updates = { ...req.body };

    // ── Reschedule penalty: -0.5 pts when dueDate changes ─────────────────────
    if (updates.dueDate && updates.dueDate !== t.dueDate) {
      const staffList  = await readDB('staff');
      const staffMember = staffList.find(s => s.id === t.staffId);
      const staffName  = staffMember?.name || req.user.name;
      await awardMerit(t.staffId, staffName, -0.5, `Task rescheduled: ${t.title}`, 'overdue', t.id);
      updates.rescheduledCount   = (t.rescheduledCount || 0) + 1;
      updates.lastRescheduledAt  = new Date().toISOString();
    }

    const updated = await updateOne('tasks', req.params.id, updates);
    broadcast('task:updated', updated);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tasks/transfer-request
// Sends a task-transfer chat message to Staff B via an existing conversation.
// Body: { taskId, toStaffId, conversationId }
router.post('/transfer-request', async (req, res) => {
  try {
    const { taskId, toStaffId, conversationId } = req.body;
    if (!taskId || !toStaffId || !conversationId) {
      return res.status(400).json({ error: 'taskId, toStaffId, and conversationId required' });
    }

    const tasks = await readDB('tasks');
    const task  = tasks.find(t => t.id === taskId);
    if (!task)           return res.status(404).json({ error: 'Task not found' });
    if (task.completed)  return res.status(400).json({ error: 'Cannot transfer a completed task' });
    if (req.user.role === 'staff' && task.staffId !== req.user.id) {
      return res.status(403).json({ error: 'Can only transfer your own tasks' });
    }

    const conversations = await readDB('conversations');
    const conv = conversations.find(c => c.id === conversationId);
    if (!conv)                          return res.status(404).json({ error: 'Conversation not found' });
    if (!conv.members.includes(toStaffId)) return res.status(400).json({ error: 'Recipient is not in this conversation' });

    const staffList = await readDB('staff');
    const toStaff   = staffList.find(s => s.id === toStaffId);
    const toStaffName = toStaff?.name || 'Staff';

    const msg = {
      id:             uuidv4(),
      conversationId,
      senderId:       req.user.id,
      senderName:     req.user.name,
      senderAvatar:   req.user.avatar || req.user.name[0].toUpperCase(),
      text:           `🔄 Task transfer request: "${task.title}"`,
      sentAt:         new Date().toISOString(),
      messageType:    'task_transfer',
      metadata: {
        taskId:           task.id,
        taskTitle:        task.title,
        taskDueDate:      task.dueDate,
        taskCustomerName: task.customerName || null,
        taskNotes:        task.notes || '',
        fromStaffId:      req.user.id,
        fromStaffName:    req.user.name,
        toStaffId,
        toStaffName,
        status:           'pending',
      },
    };

    await insertOne('chat_messages', msg);
    await updateOne('conversations', conversationId, {
      lastMessageAt:   msg.sentAt,
      lastMessageText: msg.text.slice(0, 80),
    });
    broadcast('chat:message', msg);

    res.status(201).json(msg);
  } catch (err) {
    console.error('[Transfer] request error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tasks/:id/transfer-accept
// Staff B accepts — task.staffId becomes B, transferredFrom = A.
// Body: { messageId }
router.post('/:id/transfer-accept', async (req, res) => {
  try {
    const { messageId } = req.body;
    if (!messageId) return res.status(400).json({ error: 'messageId required' });

    const tasks = await readDB('tasks');
    const task  = tasks.find(t => t.id === req.params.id);
    if (!task)          return res.status(404).json({ error: 'Task not found' });
    if (task.completed) return res.status(400).json({ error: 'Task already completed' });

    const msgs = await readDB('chat_messages');
    const msg  = msgs.find(m => m.id === messageId);
    if (!msg || msg.messageType !== 'task_transfer') return res.status(404).json({ error: 'Transfer request not found' });
    if (msg.metadata?.toStaffId   !== req.user.id)   return res.status(403).json({ error: 'Not the intended recipient' });
    if (msg.metadata?.taskId      !== req.params.id)  return res.status(400).json({ error: 'Task mismatch' });
    if (msg.metadata?.status      !== 'pending')       return res.status(400).json({ error: 'Transfer already resolved' });

    const now = new Date().toISOString();
    const updatedTask = await updateOne('tasks', req.params.id, {
      staffId:         req.user.id,
      transferredFrom: task.staffId,
      transferredAt:   now,
    });

    const updatedMsg = await updateOne('chat_messages', messageId, {
      metadata: { ...msg.metadata, status: 'accepted', resolvedAt: now },
    });

    broadcast('task:updated',         updatedTask);
    broadcast('chat:message:updated', updatedMsg);

    res.json({ task: updatedTask, message: updatedMsg });
  } catch (err) {
    console.error('[Transfer] accept error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/tasks/:id/transfer-decline
// Staff B declines — task unchanged, message status → 'declined'.
// Body: { messageId }
router.post('/:id/transfer-decline', async (req, res) => {
  try {
    const { messageId } = req.body;
    if (!messageId) return res.status(400).json({ error: 'messageId required' });

    const msgs = await readDB('chat_messages');
    const msg  = msgs.find(m => m.id === messageId);
    if (!msg || msg.messageType !== 'task_transfer') return res.status(404).json({ error: 'Transfer request not found' });
    if (msg.metadata?.toStaffId !== req.user.id)     return res.status(403).json({ error: 'Not the intended recipient' });
    if (msg.metadata?.status    !== 'pending')         return res.status(400).json({ error: 'Transfer already resolved' });

    const now = new Date().toISOString();
    const updatedMsg = await updateOne('chat_messages', messageId, {
      metadata: { ...msg.metadata, status: 'declined', resolvedAt: now },
    });

    broadcast('chat:message:updated', updatedMsg);

    res.json({ message: updatedMsg });
  } catch (err) {
    console.error('[Transfer] decline error:', err);
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
    broadcast('task:deleted', { id: req.params.id });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
