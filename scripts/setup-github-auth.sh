#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# One-time GitHub authentication setup for Kaamkaro AI auto-push pipeline
# Run once: bash scripts/setup-github-auth.sh
# After this, every Claude edit auto-pushes to GitHub → Railway deploys
# ─────────────────────────────────────────────────────────────────────────────

REPO="/Users/jaigopalarora/Kaamkaro AI"
cd "$REPO" || exit 1

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       Kaamkaro AI — One-Time GitHub Auth Setup              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Get your token at:"
echo "  github.com → Settings → Developer settings"
echo "  → Personal access tokens → Tokens (classic)"
echo "  → Generate new token → tick [repo] → copy the token"
echo ""
read -r -p "Paste your GitHub Personal Access Token: " TOKEN

if [ -z "$TOKEN" ]; then
  echo "❌ No token entered. Run again when you have it."
  exit 1
fi

# Embed token in remote URL — macOS keychain stores it automatically
git remote set-url origin "https://${TOKEN}@github.com/idkthejayarora-jpg/Kaamkaro-AI.git"

# Test the connection
echo ""
echo "🔗 Testing connection to GitHub..."
if git ls-remote origin HEAD &>/dev/null; then
  echo "✅ GitHub connection successful!"
else
  echo "❌ Connection failed — check your token and try again."
  git remote set-url origin "https://github.com/idkthejayarora-jpg/Kaamkaro-AI.git"
  exit 1
fi

# Push all pending commits
echo ""
PENDING=$(git log --oneline origin/main..HEAD 2>/dev/null | wc -l | tr -d ' ')
if [ "$PENDING" -gt 0 ]; then
  echo "📤 Pushing $PENDING pending commits to GitHub..."
  git push origin main && echo "✅ All commits pushed! Railway is now deploying..."
else
  echo "✅ Already up to date."
fi

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Pipeline is now live:                                      ║"
echo "║  Claude edits → auto-commit → auto-push → Railway deploys  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
