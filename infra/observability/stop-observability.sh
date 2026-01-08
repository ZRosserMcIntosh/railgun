#!/bin/bash
# Stop Railgun Observability Stack

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🛑 Stopping Railgun Observability Stack..."
docker compose down

echo "✅ Observability stack stopped"
echo ""
echo "To remove volumes (delete all data): docker compose down -v"
