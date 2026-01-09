#!/bin/bash

set -euo pipefail

# Stop development infrastructure
echo "🛑 Stopping Rail Gun development infrastructure..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"

if command -v docker &> /dev/null; then
  docker compose -f "$COMPOSE_FILE" down
else
  echo "❌ Docker is not installed or not in PATH"
  exit 1
fi

echo "✅ Infrastructure stopped!"
