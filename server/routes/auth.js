const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { readDB, updateOne, insertOne } = require('../utils/db');
const { authMiddleware, adminOnly, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone and password required' });
    }

    // Check admin first
    const users = await readDB('users');
    let user = users.find(u => u.phone === phone);

    // Then check staff
    if (!user) {
      const staff = await readDB('staff');
      user = staff.find(s => s.phone === phone);
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, phone: user.phone, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const users = await readDB('users');
    let user = users.find(u => u.id === req.user.id);
    if (!user) {
      const staff = await readDB('staff');
      user = staff.find(s => s.id === req.user.id);
    }
    if (!user) return res.status(404).json({ error: 'User not found' });
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/change-password  (own password)
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: 'Current and new password required' });
    if (newPassword.length < 4)
      return res.status(400).json({ error: 'New password must be at least 4 characters' });

    // Find in users then staff
    const users = await readDB('users');
    let user = users.find(u => u.id === req.user.id);
    let collection = 'users';
    if (!user) {
      const staff = await readDB('staff');
      user = staff.find(s => s.id === req.user.id);
      collection = 'staff';
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await updateOne(collection, req.user.id, { password: hashed });
    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/admin/reset-password  (admin resets any user's password)
router.post('/admin/reset-password', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword)
      return res.status(400).json({ error: 'userId and newPassword required' });
    if (newPassword.length < 4)
      return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const users = await readDB('users');
    let user = users.find(u => u.id === userId);
    let collection = 'users';
    if (!user) {
      const staff = await readDB('staff');
      user = staff.find(s => s.id === userId);
      collection = 'staff';
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

    const hashed = await bcrypt.hash(newPassword, 10);
    await updateOne(collection, userId, { password: hashed });
    res.json({ message: `Password reset for ${user.name}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/admin/users  (admin: list all users with IDs)
router.get('/admin/users', authMiddleware, adminOnly, async (req, res) => {
  try {
    const [users, staff] = await Promise.all([readDB('users'), readDB('staff')]);
    const safeUsers = users.map(({ password: _, ...u }) => ({ ...u, collection: 'users' }));
    const safeStaff = staff.map(({ password: _, ...s }) => ({ ...s, collection: 'staff' }));
    res.json([...safeUsers, ...safeStaff]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
