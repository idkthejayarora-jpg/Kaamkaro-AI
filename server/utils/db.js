const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// On Railway: mount a persistent volume at /data and set DATA_PATH=/data/kaamkaro
// On local:   defaults to server/data as before
const DATA_DIR = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(__dirname, '../data');

// ── Write queue — prevent concurrent writes from corrupting JSON files ─────────
// Each collection has its own Promise chain; writes are serialised per collection.
const writeQueue = new Map(); // collection → Promise

function queueWrite(collection, fn) {
  const prev = writeQueue.get(collection) || Promise.resolve();
  const next = prev.then(fn).catch(err => {
    // Log but don't break the chain — next write can still proceed
    console.error(`[DB writeQueue] Error in ${collection}:`, err);
    throw err; // re-throw so the original caller sees the error
  });
  // Store a version that never rejects so the chain always continues
  writeQueue.set(collection, next.catch(() => {}));
  return next;
}

// ── Transactional lock — serialise read-modify-write blocks ───────────────────
// queueWrite() only serialises the WRITE call. If route code does
// `const data = await readDB(c); data.push(x); await writeDB(c, data)`, two
// concurrent requests can both read the SAME state and clobber each other when
// writing. withLock() wraps the entire block so only one runs per collection.
//
// Usage:
//   await withLock('attendance', async () => {
//     const records = await readDB('attendance');
//     records.push(newRecord);
//     await writeDB('attendance', records);
//   });
const txnLocks = new Map(); // collection → Promise of last transaction

async function withLock(collection, fn) {
  const prev = txnLocks.get(collection) || Promise.resolve();
  let result, error;
  const myTurn = prev.then(async () => {
    try { result = await fn(); }
    catch (e) { error = e; }
  });
  // Chain head must never reject so subsequent callers always proceed
  txnLocks.set(collection, myTurn.catch(() => {}));
  await myTurn;
  if (error) throw error;
  return result;
}

// Backup only makes sense on local macOS — skip on Railway/Linux containers
const IS_LOCAL_MAC = os.platform() === 'darwin' && !process.env.RAILWAY_ENVIRONMENT;
const BACKUP_DIR = IS_LOCAL_MAC
  ? path.join(os.homedir(), 'Desktop', 'KaamkaroAI_Backup')
  : null;

async function ensureDirs() {
  await fs.ensureDir(DATA_DIR);
  if (BACKUP_DIR) await fs.ensureDir(BACKUP_DIR);
}

async function readDB(collection) {
  const filePath = path.join(DATA_DIR, `${collection}.json`);
  try {
    await fs.ensureFile(filePath);
    const content = await fs.readFile(filePath, 'utf-8');
    if (!content.trim()) return [];
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function writeDB(collection, data) {
  return queueWrite(collection, async () => {
    await ensureDirs();
    const filePath = path.join(DATA_DIR, `${collection}.json`);
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    // Real-time backup to Desktop
    await backupCollection(collection, data);
  });
}

async function backupCollection(collection, data) {
  if (!BACKUP_DIR) return; // skip on Railway/cloud deployments
  try {
    const backupFile = path.join(BACKUP_DIR, `${collection}.json`);
    await fs.writeFile(backupFile, JSON.stringify(data, null, 2), 'utf-8');
    // Timestamped snapshot — rolling last 10
    const snapshotDir = path.join(BACKUP_DIR, 'snapshots');
    await fs.ensureDir(snapshotDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(path.join(snapshotDir, `${collection}_${ts}.json`), JSON.stringify(data, null, 2), 'utf-8');
    // Prune — keep latest 10 per collection
    const files = (await fs.readdir(snapshotDir)).filter(f => f.startsWith(`${collection}_`)).sort();
    if (files.length > 10) {
      for (const f of files.slice(0, files.length - 10)) {
        await fs.remove(path.join(snapshotDir, f));
      }
    }
  } catch (err) {
    console.error('Backup error:', err.message);
  }
}

// ── Daily snapshot backup ─────────────────────────────────────────────────────
// Unlike backupCollection() (Mac-Desktop only), this writes a full timestamped
// snapshot of EVERY collection into DATA_DIR/backups — so it survives on the
// Railway persistent volume. Each run creates a dated folder; old folders are
// pruned to a rolling retention window.
const SNAPSHOT_DIR = path.join(DATA_DIR, 'backups');
const SNAPSHOT_RETENTION_DAYS = 30;

async function snapshotAllCollections(label) {
  await fs.ensureDir(SNAPSHOT_DIR);

  // Build a folder name from IST date/time (app convention: Asia/Kolkata)
  const stamp = new Date().toLocaleString('sv-SE', {
    timeZone: 'Asia/Kolkata',
  }).replace(' ', '_').replace(/:/g, '-'); // e.g. 2026-05-29_00-00-00
  const folderName = label ? `${stamp}_${label}` : stamp;
  const destDir = path.join(SNAPSHOT_DIR, folderName);
  await fs.ensureDir(destDir);

  // Copy every *.json collection file living directly in DATA_DIR
  const entries = await fs.readdir(DATA_DIR);
  let count = 0;
  for (const file of entries) {
    if (!file.endsWith('.json')) continue;
    const src = path.join(DATA_DIR, file);
    try {
      const stat = await fs.stat(src);
      if (!stat.isFile()) continue;
      await fs.copy(src, path.join(destDir, file));
      count++;
    } catch (err) {
      console.error(`[Backup] Failed to copy ${file}:`, err.message);
    }
  }

  // Prune snapshot folders older than the retention window
  try {
    const cutoff = Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const folders = await fs.readdir(SNAPSHOT_DIR);
    for (const f of folders) {
      const full = path.join(SNAPSHOT_DIR, f);
      try {
        const st = await fs.stat(full);
        if (st.isDirectory() && st.mtimeMs < cutoff) {
          await fs.remove(full);
        }
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.error('[Backup] Prune failed:', err.message);
  }

  console.log(`💾 Daily backup → ${folderName} (${count} collections)`);
  return { folder: folderName, count };
}

async function findById(collection, id) {
  const data = await readDB(collection);
  return data.find(item => item.id === id) || null;
}

// All of these wrap their read-modify-write block in withLock so concurrent
// callers can't clobber each other's mutations.
async function insertOne(collection, doc) {
  return withLock(collection, async () => {
    const data = await readDB(collection);
    data.push(doc);
    await writeDB(collection, data);
    return doc;
  });
}

async function updateOne(collection, id, updates) {
  return withLock(collection, async () => {
    const data = await readDB(collection);
    const idx = data.findIndex(item => item.id === id);
    if (idx === -1) return null;
    data[idx] = { ...data[idx], ...updates, updatedAt: new Date().toISOString() };
    await writeDB(collection, data);
    return data[idx];
  });
}

async function deleteOne(collection, id) {
  return withLock(collection, async () => {
    const data = await readDB(collection);
    const idx = data.findIndex(item => item.id === id);
    if (idx === -1) return false;
    data.splice(idx, 1);
    await writeDB(collection, data);
    return true;
  });
}

module.exports = { readDB, writeDB, findById, insertOne, updateOne, deleteOne, withLock, snapshotAllCollections };
