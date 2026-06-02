/**
 * Google Drive backup uploader — pure REST via global fetch (Node 18+), so no
 * `googleapis` dependency. Uploads the daily full export into a day-wise folder:
 *
 *     <parent> / Kaamkaro Backups / YYYY-MM-DD / kaamkaro-export-YYYY-MM-DD.json
 *
 * Auth model: OAuth2 refresh token belonging to the account that owns the Drive,
 * so uploaded files count against that user's quota (works with personal Gmail).
 *
 * Required env vars (inert if any are missing — the feature simply no-ops):
 *   GDRIVE_CLIENT_ID
 *   GDRIVE_CLIENT_SECRET
 *   GDRIVE_REFRESH_TOKEN
 * Optional:
 *   GDRIVE_PARENT_FOLDER_ID   — put backups under an existing folder you own.
 *                               If unset, a "Kaamkaro Backups" folder is created
 *                               in My Drive root.
 *   GDRIVE_ROOT_NAME          — override the "Kaamkaro Backups" folder name.
 */

const FOLDER_MIME = 'application/vnd.google-apps.folder';

function isConfigured() {
  return !!(process.env.GDRIVE_CLIENT_ID && process.env.GDRIVE_CLIENT_SECRET && process.env.GDRIVE_REFRESH_TOKEN);
}

// Exchange the long-lived refresh token for a short-lived access token.
async function getAccessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GDRIVE_CLIENT_ID,
      client_secret: process.env.GDRIVE_CLIENT_SECRET,
      refresh_token: process.env.GDRIVE_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(`token exchange failed: ${json.error || res.status} ${json.error_description || ''}`);
  }
  return json.access_token;
}

async function driveFetch(token, url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers || {}) } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drive API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Find a folder by name under a parent (or root); create it if it doesn't exist.
async function findOrCreateFolder(token, name, parentId) {
  const parent = parentId || 'root';
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    `mimeType = '${FOLDER_MIME}'`,
    `'${parent}' in parents`,
    'trashed = false',
  ].join(' and ');

  const search = await driveFetch(
    token,
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&spaces=drive`,
  );
  if (search.files && search.files.length > 0) return search.files[0].id;

  const created = await driveFetch(token, 'https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
  });
  return created.id;
}

// Multipart upload of a JSON string into a folder.
async function uploadJsonFile(token, filename, jsonString, folderId) {
  const boundary = '----kaamkaro' + Date.now();
  const metadata = { name: filename, parents: [folderId] };
  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) + '\r\n' +
    `--${boundary}\r\n` +
    'Content-Type: application/json\r\n\r\n' +
    jsonString + '\r\n' +
    `--${boundary}--`;

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`upload failed ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

/**
 * Upload one day's backup. `jsonString` is the full export; `dateStr` is YYYY-MM-DD.
 * Returns the created file's id/name. Throws on failure (caller logs, non-fatal).
 */
async function uploadDailyBackup(jsonString, dateStr) {
  if (!isConfigured()) throw new Error('Google Drive not configured');
  const token = await getAccessToken();

  const rootName = process.env.GDRIVE_ROOT_NAME || 'Kaamkaro Backups';
  const parentId = process.env.GDRIVE_PARENT_FOLDER_ID || null;

  const rootFolderId = await findOrCreateFolder(token, rootName, parentId);
  const dayFolderId  = await findOrCreateFolder(token, dateStr, rootFolderId);

  const filename = `kaamkaro-export-${dateStr}.json`;
  return uploadJsonFile(token, filename, jsonString, dayFolderId);
}

module.exports = { isConfigured, uploadDailyBackup, getAccessToken, findOrCreateFolder, uploadJsonFile };
