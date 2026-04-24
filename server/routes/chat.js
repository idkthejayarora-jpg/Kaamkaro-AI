const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { readDB, insertOne, updateOne, deleteOne } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const { broadcast } = require('../utils/sse');

const router = express.Router();
router.use(authMiddleware);

// ── helpers ───────────────────────────────────────────────────────────────────

function isMember(conv, userId) {
  return conv.members.includes(userId);
}

// ── GET /api/chat/conversations ───────────────────────────────────────────────
router.get('/conversations', async (req, res) => {
  try {
    const all = await readDB('conversations');
    const mine = all.filter(c => isMember(c, req.user.id));
    // Most-recently-active first
    mine.sort((a, b) => new Date(b.lastMessageAt || b.createdAt) - new Date(a.lastMessageAt || a.createdAt));
    res.json(mine);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/chat/conversations ──────────────────────────────────────────────
// Body: { type: 'direct'|'group', name?: string, members: [userId,...] }
// For direct: members = [otherUserId] — the server adds the sender.
// For group: members = full list including sender.
router.post('/conversations', async (req, res) => {
  try {
    const { type = 'direct', name, members = [] } = req.body;
    if (!Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: 'At least one member required' });
    }

    const allMembers = [...new Set([req.user.id, ...members])];

    if (type === 'direct') {
      if (allMembers.length !== 2) return res.status(400).json({ error: 'Direct chat needs exactly 2 members' });
      // Return existing direct conversation if one already exists
      const all = await readDB('conversations');
      const existing = all.find(c =>
        c.type === 'direct' &&
        c.members.length === 2 &&
        c.members.includes(allMembers[0]) &&
        c.members.includes(allMembers[1])
      );
      if (existing) return res.json(existing);
    }

    const conv = {
      id:            uuidv4(),
      type,
      name:          type === 'group' ? (name || 'Group') : null,
      members:       allMembers,
      createdBy:     req.user.id,
      createdAt:     new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
      lastMessageText: null,
    };
    await insertOne('conversations', conv);
    broadcast('chat:conversation', conv);
    res.status(201).json(conv);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── PATCH /api/chat/conversations/:id ─────────────────────────────────────────
// Rename group or add/remove members (admin only for member changes)
router.patch('/conversations/:id', async (req, res) => {
  try {
    const all = await readDB('conversations');
    const conv = all.find(c => c.id === req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!isMember(conv, req.user.id)) return res.status(403).json({ error: 'Not a member' });

    const { name, addMembers, removeMembers } = req.body;
    const updates = {};

    if (name !== undefined && conv.type === 'group') updates.name = name;

    if ((addMembers || removeMembers) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can change group members' });
    }
    if (addMembers) {
      updates.members = [...new Set([...conv.members, ...addMembers])];
    }
    if (removeMembers) {
      updates.members = (updates.members || conv.members).filter(m => !removeMembers.includes(m));
    }

    const updated = await updateOne('conversations', req.params.id, updates);
    broadcast('chat:conversation', updated);
    res.json(updated);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── GET /api/chat/conversations/:id/messages ──────────────────────────────────
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const all = await readDB('conversations');
    const conv = all.find(c => c.id === req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!isMember(conv, req.user.id)) return res.status(403).json({ error: 'Not a member' });

    const msgs = await readDB('chat_messages');
    const thread = msgs
      .filter(m => m.conversationId === req.params.id)
      .sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));
    res.json(thread);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /api/chat/conversations/:id/messages ─────────────────────────────────
router.post('/conversations/:id/messages', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Message text required' });

    const all = await readDB('conversations');
    const conv = all.find(c => c.id === req.params.id);
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });
    if (!isMember(conv, req.user.id)) return res.status(403).json({ error: 'Not a member' });

    const msg = {
      id:             uuidv4(),
      conversationId: req.params.id,
      senderId:       req.user.id,
      senderName:     req.user.name,
      senderAvatar:   req.user.avatar || req.user.name[0].toUpperCase(),
      text:           text.trim(),
      sentAt:         new Date().toISOString(),
    };
    await insertOne('chat_messages', msg);

    // Update conversation's last-message preview
    await updateOne('conversations', req.params.id, {
      lastMessageAt:   msg.sentAt,
      lastMessageText: msg.text.slice(0, 80),
    });

    // Broadcast to all clients — the frontend filters by membership
    broadcast('chat:message', msg);

    res.status(201).json(msg);
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DELETE /api/chat/conversations/:id ────────────────────────────────────────
// Only the creator (or admin) can delete a group
router.delete('/conversations/:id', async (req, res) => {
  try {
    const all = await readDB('conversations');
    const conv = all.find(c => c.id === req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    if (conv.createdBy !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only the creator or admin can delete this conversation' });
    }
    await deleteOne('conversations', req.params.id);
    broadcast('chat:conversation:deleted', { id: req.params.id });
    res.json({ message: 'Deleted' });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
