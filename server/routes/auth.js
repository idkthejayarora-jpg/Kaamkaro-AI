const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB, updateOne, insertOne, withLock } = require('../utils/db');
const { authMiddleware, adminOnly, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// ── Login brute-force protection ──────────────────────────────────────────────
// In-memory per (ip + phone): 5 fails / 15 min → 30 min lockout. Resets on restart.
const LOGIN_MAX_FAILS  = 5;
const LOGIN_WINDOW_MS  = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 30 * 60 * 1000;
const loginFailureMap  = new Map(); // key → { fails, firstFailAt, lockedUntil }

function loginClientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
}
function loginKey(req, phone) {
  return `${loginClientIp(req)}:${(phone || '').trim().toLowerCase()}`;
}
function recordLoginFailure(key) {
  const now = Date.now();
  const rec = loginFailureMap.get(key) || { fails: 0, firstFailAt: now, lockedUntil: 0 };
  if (now - rec.firstFailAt > LOGIN_WINDOW_MS) { rec.fails = 0; rec.firstFailAt = now; }
  rec.fails += 1;
  if (rec.fails >= LOGIN_MAX_FAILS) rec.lockedUntil = now + LOGIN_LOCKOUT_MS;
  loginFailureMap.set(key, rec);
}
function loginLockoutSecondsRemaining(key) {
  const rec = loginFailureMap.get(key);
  if (!rec || !rec.lockedUntil) return 0;
  const remaining = rec.lockedUntil - Date.now();
  if (remaining <= 0) { loginFailureMap.delete(key); return 0; }
  return Math.ceil(remaining / 1000);
}

// POST /api/auth/register  — self-signup for new staff
router.post('/register', async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!name?.trim() || !phone?.trim() || !password)
      return res.status(400).json({ error: 'Name, phone, and password are required' });
    if (password.length < 4)
      return res.status(400).json({ error: 'Password must be at least 4 characters' });

    // Check phone not already taken (users + staff + attendance_managers)
    const [users, staff, managers] = await Promise.all([readDB('users'), readDB('staff'), readDB('attendance_managers')]);
    const taken = [...users, ...staff, ...managers].find(u => u.phone === phone.trim());
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

    // Brute-force lockout check
    const key = loginKey(req, phone);
    const lockSecs = loginLockoutSecondsRemaining(key);
    if (lockSecs > 0) {
      return res.status(429).json({
        error: `Too many failed attempts. Try again in ${Math.ceil(lockSecs / 60)} min.`,
        retryAfter: lockSecs,
      });
    }

    // Check admin first
    const users = await readDB('users');
    let user = users.find(u => u.phone === phone);

    // Then check staff
    if (!user) {
      const staff = await readDB('staff');
      user = staff.find(s => s.phone === phone);
    }

    // Then check attendance managers
    if (!user) {
      const managers = await readDB('attendance_managers');
      user = managers.find(m => m.phone === phone);
    }

    if (!user) {
      recordLoginFailure(key);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      recordLoginFailure(key);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Success — clear any accumulated failures for this key
    loginFailureMap.delete(key);

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
    if (!user) {
      const managers = await readDB('attendance_managers');
      user = managers.find(m => m.id === req.user.id);
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

    // Find in users then staff then attendance_managers
    const users = await readDB('users');
    let user = users.find(u => u.id === req.user.id);
    let collection = 'users';
    if (!user) {
      const staff = await readDB('staff');
      user = staff.find(s => s.id === req.user.id);
      collection = 'staff';
    }
    if (!user) {
      const managers = await readDB('attendance_managers');
      user = managers.find(m => m.id === req.user.id);
      collection = 'attendance_managers';
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

// POST /api/auth/switch/:userId — admin switches into any account (staff or attendance_manager)
router.post('/switch/:userId', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { userId } = req.params;

    // Search staff first, then attendance_managers
    const [staffList, managers] = await Promise.all([
      readDB('staff'),
      readDB('attendance_managers'),
    ]);

    let target = staffList.find(s => s.id === userId && s.active !== false);
    if (!target) target = managers.find(m => m.id === userId);
    if (!target) return res.status(404).json({ error: 'Account not found' });

    const token = jwt.sign(
      { id: target.id, phone: target.phone, role: target.role, name: target.name },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    const { password: _, ...safeUser } = target;
    console.log(`[Auth] Admin ${req.user.name} switched to: ${target.name} (${target.role})`);
    res.json({ token, user: safeUser });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Attendance Manager management (admin only) ─────────────────────────────────

// GET /api/auth/managers — list all attendance managers
router.get('/managers', authMiddleware, adminOnly, async (req, res) => {
  try {
    const managers = await readDB('attendance_managers').catch(() => []);
    const safe = managers.map(({ password: _, ...m }) => m);
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/managers — create a new attendance manager
router.post('/managers', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { name, phone, password } = req.body;
    if (!name?.trim() || !phone?.trim() || !password?.trim())
      return res.status(400).json({ error: 'Name, phone (login ID), and password are required' });
    if (password.length < 4)
      return res.status(400).json({ error: 'Password must be at least 4 characters' });

    // Unique phone check across all collections
    const [users, staff, managers] = await Promise.all([
      readDB('users'),
      readDB('staff'),
      readDB('attendance_managers').catch(() => []),
    ]);
    const taken = [...users, ...staff, ...managers].find(u => u.phone === phone.trim());
    if (taken) return res.status(409).json({ error: 'This login ID is already in use' });

    const hashed = await bcrypt.hash(password, 10);
    const manager = {
      id:        uuidv4(),
      name:      name.trim(),
      phone:     phone.trim(),
      password:  hashed,
      role:      'attendance_manager',
      avatar:    name.trim()[0].toUpperCase(),
      createdAt: new Date().toISOString(),
    };

    await withLock('attendance_managers', async () => {
      const allManagers = await readDB('attendance_managers').catch(() => []);
      allManagers.push(manager);
      await writeDB('attendance_managers', allManagers);
    });

    const { password: _pw, ...safeManager } = manager;
    console.log(`[Auth] Admin ${req.user.name} created attendance manager: ${manager.name} (${manager.phone})`);

    // Return manager + plaintext password so admin can share credentials
    res.status(201).json({ manager: safeManager, plainPassword: password.trim() });
  } catch (err) {
    console.error('[Create manager]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/auth/managers/:id — remove a manager
router.delete('/managers/:id', authMiddleware, adminOnly, async (req, res) => {
  try {
    const managers = await readDB('attendance_managers').catch(() => []);
    const idx = managers.findIndex(m => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Manager not found' });

    const [removed] = managers.splice(idx, 1);
    await writeDB('attendance_managers', managers);

    console.log(`[Auth] Admin ${req.user.name} removed attendance manager: ${removed.name}`);
    res.json({ message: 'Manager removed' });
  } catch (err) {
    console.error('[Delete manager]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/auth/managers/:id/reset-password — admin resets a manager's password
router.patch('/managers/:id/reset-password', authMiddleware, adminOnly, async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4)
      return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const managers = await readDB('attendance_managers').catch(() => []);
    const idx = managers.findIndex(m => m.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Manager not found' });

    managers[idx].password = await bcrypt.hash(newPassword, 10);
    await writeDB('attendance_managers', managers);

    res.json({ message: 'Password updated', plainPassword: newPassword });
  } catch (err) {
    console.error('[Reset manager pw]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
