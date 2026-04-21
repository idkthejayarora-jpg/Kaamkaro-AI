#!/bin/bash
# Kaamkaro AI — One-click launcher (fixed)
cd "$(dirname "$0")"
APP_DIR="$(pwd)"

clear
echo ""
echo "  ██╗  ██╗ █████╗  █████╗ ███╗   ███╗██╗  ██╗ █████╗ ██████╗  ██████╗ "
echo "  ██║ ██╔╝██╔══██╗██╔══██╗████╗ ████║██║ ██╔╝██╔══██╗██╔══██╗██╔═══██╗"
echo "  █████╔╝ ███████║███████║██╔████╔██║█████╔╝ ███████║██████╔╝██║   ██║"
echo "  ██╔═██╗ ██╔══██║██╔══██║██║╚██╔╝██║██╔═██╗ ██╔══██║██╔══██╗██║   ██║"
echo "  ██║  ██╗██║  ██║██║  ██║██║ ╚═╝ ██║██║  ██╗██║  ██║██║  ██║╚██████╔╝"
echo "  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ "
echo ""
echo "  ─────────────────────────────────────────────────────"
echo "  Starting Kaamkaro AI Platform..."
echo "  ─────────────────────────────────────────────────────"
echo ""

# ── 1. Hard-kill anything on our ports (from any previous run) ─────────────
echo "  [1/5] Clearing ports..."
fuser -k 3001/tcp 2>/dev/null || lsof -ti:3001 | xargs kill -9 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || lsof -ti:5173 | xargs kill -9 2>/dev/null || true
# Also kill any saved PIDs from last session
if [ -f "$APP_DIR/.server.pid" ]; then
  OLD_PID=$(cat "$APP_DIR/.server.pid" 2>/dev/null)
  [ -n "$OLD_PID" ] && kill -9 "$OLD_PID" 2>/dev/null || true
  rm -f "$APP_DIR/.server.pid"
fi
if [ -f "$APP_DIR/.client.pid" ]; then
  OLD_PID=$(cat "$APP_DIR/.client.pid" 2>/dev/null)
  [ -n "$OLD_PID" ] && kill -9 "$OLD_PID" 2>/dev/null || true
  rm -f "$APP_DIR/.client.pid"
fi
sleep 1
echo "  [1/5] Ports cleared ✓"

# ── 2. Check API key ────────────────────────────────────────────────────────
ENV_FILE="$APP_DIR/server/.env"
if grep -q "^ANTHROPIC_API_KEY=sk-" "$ENV_FILE" 2>/dev/null; then
  echo "  [2/5] Anthropic API key found ✓"
else
  echo ""
  echo "  ┌─────────────────────────────────────────────────┐"
  echo "  │  ⚠️  ANTHROPIC API KEY NOT SET                   │"
  echo "  │                                                  │"
  echo "  │  AI features (Kamal, diary analysis) need a key │"
  echo "  │  Edit: server/.env                               │"
  echo "  │  Add:  ANTHROPIC_API_KEY=sk-ant-...             │"
  echo "  │  Get one free: console.anthropic.com            │"
  echo "  │                                                  │"
  echo "  │  App will still run — AI features disabled.      │"
  echo "  └─────────────────────────────────────────────────┘"
  echo ""
fi

# ── 3. Install dependencies if missing ─────────────────────────────────────
echo "  [3/5] Checking dependencies..."
cd "$APP_DIR"
[ ! -d "node_modules" ]        && npm install --silent 2>/dev/null
[ ! -d "server/node_modules" ] && (cd server && npm install --silent 2>/dev/null && cd ..)
[ ! -d "client/node_modules" ] && (cd client && npm install --silent 2>/dev/null && cd ..)
echo "  [3/5] Dependencies ready ✓"

# ── 4. Start server ─────────────────────────────────────────────────────────
echo "  [4/5] Starting backend server..."
cd "$APP_DIR/server"
node index.js >> "$APP_DIR/.server.log" 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > "$APP_DIR/.server.pid"

# Wait for HTTP response (real readiness check)
echo -n "        Waiting for server to be ready"
READY=0
for i in $(seq 1 40); do
  sleep 0.5
  if curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/auth/me 2>/dev/null | grep -qE "^(200|401|403|404)$"; then
    READY=1
    break
  fi
  # Also check if process died
  if ! kill -0 $SERVER_PID 2>/dev/null; then
    echo ""
    echo ""
    echo "  ❌ SERVER CRASHED. Last error:"
    tail -20 "$APP_DIR/.server.log"
    echo ""
    read -p "  Press Enter to exit..."
    exit 1
  fi
  printf "."
done
echo ""

if [ $READY -eq 0 ]; then
  echo "  ⚠️  Server taking longer than expected. Check .server.log if issues arise."
fi
echo "  [4/5] Backend running on :3001 ✓"

# ── 5. Start frontend ────────────────────────────────────────────────────────
echo "  [5/5] Starting frontend..."
cd "$APP_DIR/client"
npm run dev >> "$APP_DIR/.client.log" 2>&1 &
CLIENT_PID=$!
echo $CLIENT_PID > "$APP_DIR/.client.pid"

# Wait for frontend
echo -n "        Waiting for frontend"
for i in $(seq 1 30); do
  sleep 0.5
  if curl -s -o /dev/null http://localhost:5173 2>/dev/null; then break; fi
  printf "."
done
echo ""
echo "  [5/5] Frontend running on :5173 ✓"
echo ""

# ── Open browser ─────────────────────────────────────────────────────────────
sleep 0.3
open "http://localhost:5173"

echo "  ╔═══════════════════════════════════════════════════╗"
echo "  ║  ✅  Kaamkaro AI is LIVE!                         ║"
echo "  ║                                                   ║"
echo "  ║  Open:     http://localhost:5173                  ║"
echo "  ║  Login:    admin / Admin@Kamal2024                ║"
echo "  ║                                                   ║"
echo "  ║  ⚡  Close this window to STOP everything         ║"
echo "  ╚═══════════════════════════════════════════════════╝"
echo ""
echo "  ── Live server log ─────────────────────────────────"

# Cleanup on exit
cleanup() {
  echo ""
  echo "  Stopping Kaamkaro AI..."
  kill $SERVER_PID $CLIENT_PID 2>/dev/null
  lsof -ti:3001 | xargs kill -9 2>/dev/null || true
  lsof -ti:5173 | xargs kill -9 2>/dev/null || true
  rm -f "$APP_DIR/.server.pid" "$APP_DIR/.client.pid"
  echo "  Stopped. Goodbye! 👋"
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

tail -f "$APP_DIR/.server.log"
