#!/bin/bash

# Start Rail Gun development environment
# This script starts both the API server and the desktop app

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"
API_DIR="$PROJECT_ROOT/services/api"
DESKTOP_DIR="$PROJECT_ROOT/apps/desktop"

echo "🚀 Starting Rail Gun Development Environment"
echo "=========================================="

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

if [ ! -d "$API_DIR" ]; then
  echo "❌ API directory not found: $API_DIR"
  exit 1
fi

if [ ! -d "$DESKTOP_DIR" ]; then
  echo "❌ Desktop directory not found: $DESKTOP_DIR"
  exit 1
fi

# Start API server in background
echo -e "${BLUE}[1/2]${NC} Starting API server..."
(cd "$API_DIR" && pnpm dev > /tmp/railgun-api.log 2>&1) &
API_PID=$!
trap 'kill "$API_PID" 2>/dev/null' EXIT
echo -e "${GREEN}✓${NC} API server started (PID: $API_PID)"
echo "    Logs: tail -f /tmp/railgun-api.log"

sleep 3

# Start desktop app in foreground
echo -e "${BLUE}[2/2]${NC} Starting desktop app..."
cd "$DESKTOP_DIR"
pnpm dev
