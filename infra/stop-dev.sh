#!/bin/bash

# Stop development infrastructure
echo "🛑 Stopping Rail Gun development infrastructure..."

if command -v docker &> /dev/null; then
  docker compose -f infra/docker-compose.yml down
else
  echo "❌ Docker is not installed or not in PATH"
  exit 1
fi

echo "✅ Infrastructure stopped!"
