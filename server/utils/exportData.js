/**
 * Shared full-export builder — used by both the /api/export download route and
 * the daily Google Drive backup. One source of truth for "all the data".
 */
const fs = require('fs-extra');
const path = require('path');
const { readDB } = require('./db');

const DATA_DIR = process.env.DATA_PATH
  ? path.resolve(process.env.DATA_PATH)
  : path.join(__dirname, '../data');

// Collections holding password hashes — stripped from every export.
const SENSITIVE = new Set(['staff', 'users', 'attendance_managers']);

// Build a complete snapshot object of every *.json collection in the data dir
// (the `backups` sub-folder is a directory, so the .json filter skips it).
async function buildFullExport(exportedBy = 'system') {
  const files = (await fs.readdir(DATA_DIR)).filter(f => f.endsWith('.json'));
  const data = {};

  for (const file of files) {
    const col = file.replace(/\.json$/, '');
    let rows = await readDB(col);
    if (Array.isArray(rows) && SENSITIVE.has(col)) {
      rows = rows.map(({ password: _p, ...rest }) => rest);
    }
    data[col] = rows;
  }

  return {
    exportedAt:  new Date().toISOString(),
    exportedBy,
    collections: files.map(f => f.replace(/\.json$/, '')),
    data,
  };
}

module.exports = { buildFullExport };
