require('dotenv').config();
// On Railway, PORT is always set — use that as a proxy for "production" environment
if (process.env.PORT && !process.env.NODE_ENV) {
  process.env.NODE_ENV = 'production';
}
const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { readDB, writeDB } = require('./utils/db');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ─────────────────────────────────────────────────────────────────
// Allow same-origin requests (Railway) + localhost dev + any explicitly set CLIENT_URL
app.use(cors({
  origin: (origin, cb) => {
    // No origin = same-origin request (mobile app, curl, server-to-server) — always allow
    if (!origin) return cb(null, true);
    const allowed = [
      process.env.CLIENT_URL,
      'http://localhost:5173',
      'http://localhost:3001',
    ].filter(Boolean);
    // Allow any Railway domain or explicitly listed origin
    if (allowed.includes(origin) || origin.endsWith('.railway.app') || origin.endsWith('.up.railway.app')) {
      return cb(null, true);
    }
    cb(null, true); // permissive — tighten if needed
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Health check (no auth required — used by Railway) ─────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/staff',        require('./routes/staff'));
app.use('/api/customers',    require('./routes/customers'));
app.use('/api/vendors',      require('./routes/vendors'));
app.use('/api/interactions', require('./routes/interactions'));
app.use('/api/tasks',        require('./routes/tasks'));
app.use('/api/diary',        require('./routes/diary'));
app.use('/api/export',       require('./routes/export'));
app.use('/api/audit',        require('./routes/audit'));
app.use('/api/ai',           require('./routes/ai'));
app.use('/api/goals',        require('./routes/goals'));
app.use('/api/templates',    require('./routes/templates'));
app.use('/api/webhook',      require('./routes/webhook'));
app.use('/api/events',       require('./routes/events'));
app.use('/api/broadcast',    require('./routes/broadcast'));
app.use('/api/merits',       require('./routes/merits'));
app.use('/api/attendance',   require('./routes/attendance'));

// ── Static frontend serving ────────────────────────────────────────────────────
// Serve React app whenever the dist folder exists — works on Railway regardless
// of NODE_ENV, and skips gracefully in local dev (where dist isn't built)
const distDir   = path.join(__dirname, '../client/dist');
const indexHtml = path.join(distDir, 'index.html');
const fs = require('fs');
if (fs.existsSync(indexHtml)) {
  app.use(express.static(distDir));
  app.get('*', (req, res) => res.sendFile(indexHtml));
}

// ── Express error middleware — must be AFTER all routes ───────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[Express Error]', err);
  res.status(500).json({ error: 'Server error', message: err.message });
});

// ── First-run seed ────────────────────────────────────────────────────────────
// Only creates the admin account if no users exist.
// All other data starts empty — add your own staff, customers, and vendors.
async function seed() {
  // Ensure data dir exists
  const path = require('path');
  const fs   = require('fs-extra');
  const dataDir = path.join(__dirname, 'data');
  await fs.ensureDir(dataDir);

  // Create admin account if no users exist
  const users = await readDB('users');
  if (!Array.isArray(users) || users.length === 0) {
    const hashed = await bcrypt.hash('Admin@Kamal2024', 10);
    await writeDB('users', [{
      id: uuidv4(),
      name: 'Admin',
      phone: 'admin',
      password: hashed,
      role: 'admin',
      email: '',
      joinDate: new Date().toISOString(),
      avatar: 'A',
      createdAt: new Date().toISOString(),
    }]);
    console.log('✅ Admin account created');
    console.log('   Phone:    admin');
    console.log('   Password: Admin@Kamal2024');
    console.log('   ⚠️  Change this password after first login\n');
  } else {
    console.log(`✅ Found ${users.length} admin user(s)`);
  }

  // Ensure all other collections exist (never overwrite existing data)
  const collections = ['staff', 'customers', 'vendors', 'performance', 'interactions', 'tasks', 'diary', 'auditLog', 'goals', 'templates', 'broadcasts', 'merits', 'meritGoals', 'vendorInteractions', 'config'];
  for (const col of collections) {
    const filePath = path.join(dataDir, `${col}.json`);
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      await writeDB(col, []);
      console.log(`  Created empty collection: ${col}`);
    }
  }
}

// ── Global unhandled error catchers — prevent server crashes ──────────────────
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection]', reason);
  // Do NOT exit — keep server alive
});
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException]', err);
  // Do NOT exit — keep server alive
});

// ── Start ──────────────────────────────────────────────────────────────────────
// seed() failure must NOT prevent the server from starting
function startServer() {
  app.listen(PORT, () => {
    console.log(`\n🚀 Kaamkaro AI → http://localhost:${PORT}`);
    if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'your-key-here') {
      console.log(`🤖 Kamal AI   → active (claude-sonnet-4-6)`);
    } else {
      console.log(`⚠️  Kamal AI   → NO API KEY — set ANTHROPIC_API_KEY in Railway env vars`);
      console.log(`   Diary analysis and Kamal AI chat will use fallback mode until key is set.\n`);
    }
  });
}

seed()
  .catch(err => {
    console.error('[Seed] Failed — starting server anyway:', err);
  })
  .finally(() => {
    startServer();
  });
