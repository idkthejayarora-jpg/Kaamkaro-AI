#!/bin/bash
set -e

echo ""
echo "╔════════════════════════════════════════╗"
echo "║       Kaamkaro AI — Setup Script       ║"
echo "╚════════════════════════════════════════╝"
echo ""

# Check Node
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found."
  echo ""
  echo "Install Node.js first:"
  echo "  Option 1 (Homebrew): brew install node"
  echo "  Option 2 (Direct):   https://nodejs.org  → Download LTS"
  echo ""
  exit 1
fi

NODE_VER=$(node --version)
echo "✅ Node.js $NODE_VER found"
echo ""

# Install root deps
echo "📦 Installing root dependencies..."
npm install
echo ""

# Install server deps
echo "📦 Installing server dependencies..."
cd server && npm install && cd ..
echo ""

# Install client deps
echo "📦 Installing client dependencies..."
cd client && npm install && cd ..
echo ""

echo "✅ All dependencies installed!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀 Start the app:"
echo "     npm run dev"
echo ""
echo "  🌐 Then open: http://localhost:5173"
echo ""
echo "  🔑 Admin login:"
echo "     Username: admin"
echo "     Password: Admin@Kamal2024"
echo ""
echo "  🤖 For full AI features, add your"
echo "     Anthropic API key to server/.env:"
echo "     ANTHROPIC_API_KEY=sk-ant-..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
