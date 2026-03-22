#!/bin/bash
# Initialize local data directories for Docker volumes
set -e

DATA_DIR="${1:-./data}"

echo "Creating data directories in: $DATA_DIR"

mkdir -p "$DATA_DIR/db"
mkdir -p "$DATA_DIR/projects"
mkdir -p "$DATA_DIR/downloads"
mkdir -p "$DATA_DIR/logs"
mkdir -p "$DATA_DIR/browser-profiles/gemini"
mkdir -p "$DATA_DIR/browser-profiles/chatgpt"
mkdir -p "$DATA_DIR/browser-profiles/suno"
mkdir -p "$DATA_DIR/browser-profiles/grok"
mkdir -p "$DATA_DIR/browser-profiles/canva"
mkdir -p "$DATA_DIR/browser-profiles/capcut"

echo "✓ Data directories created"
echo ""
echo "Next steps:"
echo "  1. docker compose build"
echo "  2. docker compose up -d"
echo "  3. Open http://localhost:3000"
echo "  4. Go to Settings to connect browser profiles"
