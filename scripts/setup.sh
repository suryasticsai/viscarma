#!/bin/bash
# VisCarma version 1.0 – One‑click setup for Git Bash / Linux / macOS

set -e

echo "🔱 VisCarma Setup"
echo "=================="
echo ""

# 1. Check Node.js
echo "📦 Checking Node.js..."
if command -v node &> /dev/null; then
    echo "✅ Node.js found: $(node -v)"
else
    echo "❌ Node.js not found. Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

# 2. Check npm
echo "📦 Checking npm..."
if command -v npm &> /dev/null; then
    echo "✅ npm found: $(npm -v)"
else
    echo "❌ npm not found. Please install Node.js (includes npm)."
    exit 1
fi

# 3. Check Python 3
echo "🐍 Checking Python 3..."
if command -v python3 &> /dev/null; then
    echo "✅ Python3 found: $(python3 --version)"
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    echo "✅ Python found: $(python --version)"
    PYTHON_CMD="python"
else
    echo "❌ Python not found. Please install Python 3.11+ from https://python.org/"
    exit 1
fi

# 4. Check pip
echo "📦 Checking pip..."
if $PYTHON_CMD -m pip --version &> /dev/null; then
    echo "✅ pip found: $($PYTHON_CMD -m pip --version)"
else
    echo "❌ pip not found. Please ensure pip is installed."
    exit 1
fi

# 5. Install Node dependencies
echo ""
echo "📦 Installing Node dependencies..."
cd "$(dirname "$0")/.."
npm install

# 6. Install Aider
echo ""
echo "🐍 Installing Aider..."
$PYTHON_CMD -m pip install aider-chat

# 7. Check Ollama
echo ""
echo "🦙 Checking Ollama..."
if command -v ollama &> /dev/null; then
    echo "✅ Ollama found: $(ollama --version)"
else
    echo "⚠️ Ollama not found in PATH. Please install Ollama from https://ollama.com/"
    echo "   After installation, pull a code model:"
    echo "   ollama pull qwen2.5-coder:7b"
    exit 1
fi

# 8. Check if the model is pulled
echo ""
echo "📦 Checking for qwen2.5-coder:7b..."
if ollama list | grep -q "qwen2.5-coder:7b"; then
    echo "✅ qwen2.5-coder:7b is already pulled."
else
    echo "⬇️ Pulling qwen2.5-coder:7b (this may take a few minutes)..."
    ollama pull qwen2.5-coder:7b
fi

echo ""
echo "✅ Setup complete! You can now run VisCarma."
echo "🚀 Start the dashboard with: node server.js"
echo "🌐 Open http://localhost:9000"