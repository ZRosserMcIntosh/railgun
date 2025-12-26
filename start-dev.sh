#!/bin/bash

# Start Rail Gun development environment
# This script starts both the API server and the desktop app

echo "🚀 Starting Rail Gun Development Environment"
echo "=========================================="

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Start API server in background
echo -e "${BLUE}[1/2]${NC} Starting API server..."
cd /Users/rossermcintosh/Desktop/Rail\ Gun/services/api
npm run dev > /tmp/railgun-api.log 2>&1 &
API_PID=$!
echo -e "${GREEN}✓${NC} API server started (PID: $API_PID)"
echo "    Logs: tail -f /tmp/railgun-api.log"

sleep 3

# Start desktop app in foreground
echo -e "${BLUE}[2/2]${NC} Starting desktop app..."
cd /Users/rossermcintosh/Desktop/Rail\ Gun/apps/desktop
npm run dev

# Cleanup on exit
trap "kill $API_PID 2>/dev/null" EXIT
