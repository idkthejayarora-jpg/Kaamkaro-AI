const fs = require('fs-extra');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(__dirname, '../data');
const BACKUP_DIR = path.join(os.homedir(), 'Desktop', 'KaamkaroAI_Backup');

async function ensureDirs() {
  await fs.ensureDir(DATA_DIR);
  await fs.ensureDir(BACKUP_DIR);
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
  await ensureDirs();
  const filePath = path.join(DATA_DIR, `${collection}.json`);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  // Real-time backup to Desktop
  await backupCollection(collection, data);
}

async function backupCollection(collection, data) {
  try {
    const backupFile = path.join(BACKUP_DIR, `${collection}.json`);
    await fs.writeFile(backupFile, JSON.stringify(data, null, 2), 'utf-8');
    // Also write a timestamped snapshot every time (rolling last 10)
    const snapshotDir = path.join(BACKUP_DIR, 'snapshots');
    await fs.ensureDir(snapshotDir);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotFile = path.join(snapshotDir, `${collection}_${ts}.json`);
    await fs.writeFile(snapshotFile, JSON.stringify(data, null, 2), 'utf-8');
    // Prune old snapshots — keep latest 10 per collection
    const files = (await fs.readdir(snapshotDir))
      .filter(f => f.startsWith(`${collection}_`))
      .sort();
    if (files.length > 10) {
      const toDelete = files.slice(0, files.length - 10);
      for (const f of toDelete) {
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
