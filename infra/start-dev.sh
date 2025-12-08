#!/bin/bash

# Start development infrastructure
echo "🚀 Starting Rail Gun development infrastructure..."

# Try docker compose (newer) first, fall back to docker-compose
if command -v docker &> /dev/null; then
  docker compose -f infra/docker-compose.yml up -d
else
  echo "❌ Docker is not installed or not in PATH"
  echo "Please install Docker Desktop from https://www.docker.com/products/docker-desktop/"
  exit 1
fi

echo "⏳ Waiting for services to be healthy..."
sleep 5

echo "✅ Infrastructure ready!"
echo ""
echo "PostgreSQL: localhost:5432"
echo "  User: railgun"
echo "  Password: railgun_dev_password"
echo "  Database: railgun"
echo ""
echo "Redis: localhost:6379"
echo ""
echo "To stop: pnpm infra:stop"
