# Kaamkaro AI — Hosting Guide (Real-Time / Always-On)

This guide covers three hosting options from easiest to most powerful.
All of them make the app accessible from **any phone or laptop** via a URL.

---

## Option A — Render.com (Recommended · Free to start)

Render hosts Node.js apps for free with zero server management.
The free tier sleeps after 15 min of inactivity (wakes in ~30s).
Paid plan ($7/month) keeps it always-on.

### Step 1 — Push your code to GitHub

1. Go to https://github.com and create a new **private** repository named `kaamkaro-ai`
2. Open Terminal in your project folder and run:

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/kaamkaro-ai.git
git push -u origin main
```

> ⚠️  Before pushing, add a `.gitignore` so you don't upload secrets:
> ```
> server/data/
> node_modules/
> client/node_modules/
> server/node_modules/
> client/dist/
> .env
> *.log
> .server.pid
> .client.pid
> ```

### Step 2 — Build the frontend into the backend

The production mode serves the React app as static files from Express.
Add a build command to your `package.json`:

```json
"build": "cd client && npm install && npm run build",
"start": "NODE_ENV=production node server/index.js"
```

Then in `server/index.js`, make sure the static serving block exists
(it already does — the `if (process.env.NODE_ENV === 'production')` block).

### Step 3 — Deploy on Render

1. Go to https://render.com → Sign up with GitHub
2. Click **New → Web Service**
3. Connect your GitHub repo
4. Fill in:
   - **Name**: `kaamkaro-ai`
   - **Root Directory**: *(leave blank)*
   - **Build Command**: `npm run build`
   - **Start Command**: `node server/index.js`
   - **Environment**: Node
5. Add **Environment Variables** (click "Add Environment Variable"):
   ```
   NODE_ENV          = production
   JWT_SECRET        = SomeRandomLongSecretString123!
   ANTHROPIC_API_KEY = sk-ant-...your key...
   CLIENT_URL        = https://kaamkaro-ai.onrender.com
   PORT              = 10000
   ```
6. Click **Create Web Service** — it deploys automatically

Your app will be live at: `https://kaamkaro-ai.onrender.com`

### Step 4 — Persistent data on Render

Render's free disk resets on each deploy. To keep your data:

**Option 1 — Render Disk** ($1/month):
- Go to your service → Disks → Add Disk
- Mount path: `/app/server/data`
- This persists all JSON files across deploys

**Option 2 — Use a free database** (recommended for production):
- Sign up at https://neon.tech (free PostgreSQL) or https://planetscale.com
- Replace the JSON file storage with SQL (requires code changes)

---

## Option B — Railway.app (Easiest · $5/month credit free)

Railway is even simpler than Render.

1. Go to https://railway.app → Sign up with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select your repo
4. Railway auto-detects Node.js
5. Go to **Variables** and add:
   ```
   NODE_ENV          = production
   JWT_SECRET        = SomeRandomLongSecretString123!
   ANTHROPIC_API_KEY = sk-ant-...
   PORT              = 3000
   ```
6. Go to **Settings → Networking → Generate Domain**
7. Your app is live instantly

Railway gives $5 free credit/month — enough for a small app.

---

## Option C — VPS / DigitalOcean Droplet ($6/month · Full control)

Best for: teams, heavy usage, custom domains, no sleep.

### Step 1 — Create a server

1. Sign up at https://digitalocean.com
2. Create a **Droplet**: Ubuntu 22.04, Basic plan, $6/month (1GB RAM)
3. Add your SSH key during setup

### Step 2 — Connect and install

```bash
ssh root@YOUR_SERVER_IP

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt-get install -y nodejs

# Install PM2 (keeps app alive after crashes/reboots)
npm install -g pm2

# Install nginx (reverse proxy)
apt install -y nginx
```

### Step 3 — Upload your code

On your Mac, run:
```bash
# Copy project to server (exclude data and node_modules)
rsync -av --exclude='node_modules' --exclude='server/data' --exclude='client/dist' \
  "/Users/jaigopalarora/Kaamkaro AI/" root@YOUR_SERVER_IP:/var/www/kaamkaro/
```

### Step 4 — Set up on server

```bash
cd /var/www/kaamkaro

# Create data directory
mkdir -p server/data

# Install dependencies
npm install
cd server && npm install && cd ..
cd client && npm install && npm run build && cd ..

# Create .env file
cat > server/.env << EOF
NODE_ENV=production
JWT_SECRET=SomeRandomLongSecretString123!
ANTHROPIC_API_KEY=sk-ant-...your key...
PORT=3001
EOF

# Start with PM2
pm2 start server/index.js --name kaamkaro
pm2 startup    # makes it start on server reboot
pm2 save
```

### Step 5 — Set up nginx (custom domain + HTTPS)

```bash
# Replace kaamkaro.yourdomain.com with your actual domain
cat > /etc/nginx/sites-available/kaamkaro << 'EOF'
server {
    listen 80;
    server_name kaamkaro.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 50m;
    }
}
EOF

ln -s /etc/nginx/sites-available/kaamkaro /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Free HTTPS with Let's Encrypt
apt install -y certbot python3-certbot-nginx
certbot --nginx -d kaamkaro.yourdomain.com
```

### Step 6 — Point your domain

In your domain registrar (GoDaddy, Namecheap, etc.):
- Add an **A record**: `kaamkaro` → `YOUR_SERVER_IP`

Your app is now live at `https://kaamkaro.yourdomain.com` with HTTPS.

---

## Backing Up Your Data

Your JSON data lives in `server/data/`. Back it up regularly.

**Automatic daily backup to Google Drive / Dropbox:**
```bash
# On VPS — add to crontab (runs every night at 2am)
crontab -e
# Add this line:
0 2 * * * tar -czf ~/backup-$(date +%Y%m%d).tar.gz /var/www/kaamkaro/server/data && \
          find ~ -name "backup-*.tar.gz" -mtime +7 -delete
```

**Manual backup from Mac:**
```bash
scp -r root@YOUR_SERVER_IP:/var/www/kaamkaro/server/data ./backup-$(date +%Y%m%d)
```

---

## Custom Domain (for any option)

1. Buy a domain at https://namecheap.com (~$10/year)
2. In DNS settings, add:
   - Render/Railway: add a **CNAME** record pointing to their URL
   - VPS: add an **A** record pointing to your IP
3. In Render/Railway dashboard, add your custom domain under Settings

---

## Quick Comparison

| Option       | Cost       | Setup Time | Always-On | Custom Domain | Best For |
|--------------|------------|------------|-----------|---------------|----------|
| Render (free)| Free       | 15 min     | No (sleeps) | Yes (free)  | Testing  |
| Render (paid)| $7/month   | 15 min     | Yes       | Yes           | Small teams |
| Railway      | ~$5/month  | 10 min     | Yes       | Yes           | Small teams |
| DigitalOcean | $6/month   | 1 hour     | Yes       | Yes           | Full control |

**My recommendation**: Start with **Render free tier** to test, then upgrade to Render paid ($7/mo) or Railway once happy.

---

## Environment Variables Needed (always set these)

```
NODE_ENV          = production
JWT_SECRET        = (any long random string — keep it secret)
ANTHROPIC_API_KEY = sk-ant-api03-...   (from console.anthropic.com)
CLIENT_URL        = https://your-app-url.com
PORT              = 3001 (or whatever the platform needs)
```

---

## After deploying — first login

Same credentials work everywhere:
```
Phone:    admin
Password: Admin@Kamal2024
```
Change the password immediately after first login via Staff management.
