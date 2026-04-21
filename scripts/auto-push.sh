#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Kaamkaro AI — Auto-push to GitHub after Claude edits
# Triggered by Claude Code PostToolUse hook on every file write/edit
# GitHub → Railway auto-deploy picks it up from there
# ─────────────────────────────────────────────────────────────────────────────

REPO="/Users/jaigopalarora/Kaamkaro AI"
cd "$REPO" || exit 0

# Nothing to do if working tree is clean
if git diff --quiet && git diff --staged --quiet; then
  exit 0
fi

# Stage everything (Claude edits are intentional changes)
git add -A

# Build a smart commit message from changed files
CHANGED=$(git diff --staged --name-only | head -6 | tr '\n' ' ')
TIMESTAMP=$(date '+%d %b %H:%M')
MSG="🤖 Claude update [${TIMESTAMP}]: ${CHANGED}"

# Commit — skip hooks so this never fails on lint warnings
git commit -m "$MSG" --no-verify 2>/dev/null

# Push to whatever branch is current (main or master)
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
git push origin "$BRANCH" 2>/dev/null && echo "✅ Pushed → Railway deploying..." || echo "⚠️  Push failed — check git remote/auth"
