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
const { readDB, writeDB, withLock, DATA_DIR } = require('./utils/db');

const compression = require('compression');
const app = express();
const PORT = process.env.PORT || 3001;

// Gzip all responses — cuts JS/CSS transfer size by ~65% on mobile networks.
// Must be the very first middleware so it wraps everything including static files.
app.use(compression({ level: 6 }));

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
// Uploaded files are uuid-named (content never changes under a name) → cache long.
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
  maxAge: '30d',
  immutable: true,
}));

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
app.use('/api/chat',         require('./routes/chat'));
app.use('/api/merits',       require('./routes/merits'));
app.use('/api/attendance',   require('./routes/attendance'));
app.use('/api/kiosk',        require('./routes/kiosk'));
app.use('/api/leaves',       require('./routes/leaves'));
app.use('/api/insights',     require('./routes/insights'));
app.use('/api/holidays',     require('./routes/holidays'));
app.use('/api/teams',        require('./routes/teams'));
app.use('/api/leads',        require('./routes/leads'));
app.use('/api/stock',        require('./routes/stock'));
app.use('/api/badges',       require('./routes/badges'));
app.use('/api/calendar',     require('./routes/calendar'));
app.use('/api/fraud',        require('./routes/fraud'));
app.use('/api/tag-defs',     require('./routes/tagDefs'));
app.use('/api/payroll',      require('./routes/payroll'));
app.use('/api/admin',        require('./routes/admin'));

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

  // Create admin account if no users exist (check-then-write under the lock so
  // two concurrent boots can't both seed)
  await withLock('users', async () => {
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
  });

  // Create default attendance manager if none exist
  await withLock('attendance_managers', async () => {
    const managers = await readDB('attendance_managers').catch(() => []);
    if (!Array.isArray(managers) || managers.length === 0) {
      const mgrHashed = await bcrypt.hash('Attend@2024', 10);
      await writeDB('attendance_managers', [{
        id: '20d5a473-9b98-445b-b20a-a9d98d4edc90',
        name: 'Arkan',
        phone: 'arkan',
        password: mgrHashed,
        role: 'attendance_manager',
        active: true,
        createdAt: new Date().toISOString(),
      }]);
      console.log('✅ Attendance manager created');
      console.log('   Phone:    arkan');
      console.log('   Password: Attend@2024');
    } else {
      console.log(`✅ Found ${managers.length} attendance manager(s)`);
    }
  });

  // Ensure all other collections exist (never overwrite existing data)
  const collections = ['staff', 'customers', 'vendors', 'performance', 'interactions', 'tasks', 'diary', 'auditLog', 'goals', 'templates', 'broadcasts', 'merits', 'meritGoals', 'vendorInteractions', 'config', 'teams', 'badges', 'tagDefs', 'shelfItems', 'leads', 'attendance', 'attendance_managers', 'leaves', 'payroll_config'];
  for (const col of collections) {
    const filePath = path.join(dataDir, `${col}.json`);
    const exists = await fs.pathExists(filePath);
    if (!exists) {
      await writeDB(col, []);
      console.log(`  Created empty collection: ${col}`);
    }
  }

  // ── One-shot migration: backfill missing createdAt on diary entries ────────
  // Fraud detection skips entries without createdAt — backfill from date or updatedAt.
  try {
    const diary = await readDB('diary');
    const toFix = diary.filter(d => !d.createdAt);
    if (toFix.length > 0) {
      toFix.forEach(d => {
        d.createdAt = d.updatedAt || (d.date ? `${d.date}T09:00:00.000Z` : new Date().toISOString());
      });
      await writeDB('diary', diary);
      console.log(`  Backfilled createdAt on ${toFix.length} diary entries`);
    }
  } catch (e) {
    console.error('[Migration] diary createdAt backfill failed (non-fatal):', e.message);
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
    // Kick off the daily self-backup (00:00 IST → DATA_DIR/backups, 30-day retention)
    try {
      require('./utils/backupScheduler').startDailyBackup();
    } catch (err) {
      console.error('[Backup] Scheduler failed to start (non-fatal):', err.message);
    }
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
