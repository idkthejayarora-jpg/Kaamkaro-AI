const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { readDB, updateOne, insertOne } = require('../utils/db');
const { authMiddleware, adminOnly, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register  — self-signup for new staff
router.post('/register', async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!name?.trim() || !phone?.trim() || !password)
      return res.status(400).json({ error: 'Name, phone, and password are required' });
    if (password.length < 4)
      return res.status(400).json({ error: 'Password must be at least 4 characters' });

    // Check phone not already taken (users + staff)
    const [users, staff] = await Promise.all([readDB('users'), readDB('staff')]);
    const taken = [...users, ...staff].find(u => u.phone === phone.trim());
    if (taken) return res.status(409).json({ error: 'This phone number is already registered' });

    const hashed = await bcrypt.hash(password, 10);
    const newStaff = {
      id:               uuidv4(),
      name:             name.trim(),
      phone:            phone.trim(),
      password:         hashed,
      role:             'staff',
      active:           true,
      avatar:           name.trim()[0].toUpperCase(),
      attendanceStatus: 'inactive',
      streakData:       { currentStreak: 0, lastActivityDate: null, longestStreak: 0 },
      createdAt:        new Date().toISOString(),
      selfRegistered:   true,   // admin can filter/review these
    };

    await insertOne('staff', newStaff);

    const token = jwt.sign(
      { id: newStaff.id, phone: newStaff.phone, role: newStaff.role, name: newStaff.name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...safeUser } = newStaff;
    console.log(`[Auth] New self-registration: ${newStaff.name} (${newStaff.phone})`);
    res.status(201).json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

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

// POST /api/auth/switch/:staffId — admin switches into a staff account (no password needed)
// Issues a short-lived JWT for the target staff member, stored client-side.
// The admin's original session is preserved in localStorage under kk_admin_token.
router.post('/switch/:staffId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const staff = await readDB('staff');
    const target = staff.find(s => s.id === req.params.staffId && s.active !== false);
    if (!target) return res.status(404).json({ error: 'Staff member not found or inactive' });

    const token = jwt.sign(
      { id: target.id, phone: target.phone, role: target.role, name: target.name },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    const { password: _, ...safeUser } = target;
    console.log(`[Auth] Admin ${req.user.name} switched to staff account: ${target.name}`);
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
