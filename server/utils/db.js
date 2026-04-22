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

async function findById(collection, id) {
  const data = await readDB(collection);
  return data.find(item => item.id === id) || null;
}

async function insertOne(collection, doc) {
  const data = await readDB(collection);
  data.push(doc);
  await writeDB(collection, data);
  return doc;
}

async function updateOne(collection, id, updates) {
  const data = await readDB(collection);
  const idx = data.findIndex(item => item.id === id);
  if (idx === -1) return null;
  data[idx] = { ...data[idx], ...updates, updatedAt: new Date().toISOString() };
  await writeDB(collection, data);
  return data[idx];
}

async function deleteOne(collection, id) {
  const data = await readDB(collection);
  const idx = data.findIndex(item => item.id === id);
  if (idx === -1) return false;
  data.splice(idx, 1);
  await writeDB(collection, data);
  return true;
}

module.exports = { readDB, writeDB, findById, insertOne, updateOne, deleteOne };
