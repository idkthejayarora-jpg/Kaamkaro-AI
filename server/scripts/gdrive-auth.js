/**
 * One-time helper to obtain a Google Drive REFRESH TOKEN for backups.
 *
 * Prerequisites (Google Cloud Console, ~5 min):
 *   1. Create / pick a project → enable "Google Drive API".
 *   2. OAuth consent screen → External → add yourself as a Test user.
 *   3. Credentials → Create OAuth client ID → application type "Desktop app".
 *      Copy the Client ID and Client secret.
 *
 * Run it (from the server/ folder):
 *   GDRIVE_CLIENT_ID=xxx GDRIVE_CLIENT_SECRET=yyy node scripts/gdrive-auth.js
 *
 * It opens a localhost callback, you approve access in the browser, and it
 * prints the GDRIVE_REFRESH_TOKEN to paste into your Railway env vars.
 *
 * Scope: drive.file — the app can only see/manage the files & folders it
 * creates (your "Kaamkaro Backups" folder). It cannot read the rest of Drive.
 */
const http = require('http');
const crypto = require('crypto');

const CLIENT_ID     = process.env.GDRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
const PORT          = Number(process.env.GDRIVE_AUTH_PORT || 53682);
const REDIRECT_URI  = `http://localhost:${PORT}`;
const SCOPE         = 'https://www.googleapis.com/auth/drive.file';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌ Set GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET first:\n');
  console.error('   GDRIVE_CLIENT_ID=xxx GDRIVE_CLIENT_SECRET=yyy node scripts/gdrive-auth.js\n');
  process.exit(1);
}

const state = crypto.randomBytes(8).toString('hex');
const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id:     CLIENT_ID,
  redirect_uri:  REDIRECT_URI,
  response_type: 'code',
  scope:         SCOPE,
  access_type:   'offline',
  prompt:        'consent',   // force a refresh_token even on re-auth
  state,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  if (!url.searchParams.get('code')) { res.writeHead(204); res.end(); return; }

  if (url.searchParams.get('state') !== state) {
    res.writeHead(400); res.end('State mismatch'); return;
  }
  const code = url.searchParams.get('code');

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI, grant_type: 'authorization_code',
      }),
    });
    const json = await tokenRes.json();
    if (!json.refresh_token) throw new Error(JSON.stringify(json));

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>✅ Done — refresh token captured. You can close this tab and check your terminal.</h2>');

    console.log('\n✅ Success! Add these to your Railway environment variables:\n');
    console.log(`GDRIVE_CLIENT_ID=${CLIENT_ID}`);
    console.log(`GDRIVE_CLIENT_SECRET=${CLIENT_SECRET}`);
    console.log(`GDRIVE_REFRESH_TOKEN=${json.refresh_token}`);
    console.log('\n(Optional) GDRIVE_PARENT_FOLDER_ID=<id of an existing Drive folder to nest backups under>\n');
  } catch (err) {
    res.writeHead(500); res.end('Token exchange failed — see terminal.');
    console.error('\n❌ Token exchange failed:', err.message);
  } finally {
    setTimeout(() => server.close(() => process.exit(0)), 500);
  }
});

server.listen(PORT, () => {
  console.log('\n🔑 Open this URL in your browser and approve access:\n');
  console.log('   ' + authUrl + '\n');
  console.log(`(Waiting for the Google redirect on ${REDIRECT_URI} …)\n`);
});
