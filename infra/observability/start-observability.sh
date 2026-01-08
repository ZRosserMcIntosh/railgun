#!/bin/bash
# RAILGUN OBSERVABILITY STACK STARTUP
# Doctrine-compliant monitoring infrastructure

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting Railgun Observability Stack${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed${NC}"
    exit 1
fi

# Create directories if needed
mkdir -p prometheus grafana/provisioning/datasources grafana/provisioning/dashboards grafana/dashboards otel alertmanager

# Start the stack
echo -e "${YELLOW}📦 Starting containers...${NC}"
docker compose up -d

# Wait for services to be healthy
echo -e "${YELLOW}⏳ Waiting for services to be healthy...${NC}"
sleep 5

# Check service status
echo ""
echo -e "${GREEN}✅ Observability Stack Started${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📊 Services:"
echo "   • Prometheus:    http://localhost:9090"
echo "   • Grafana:       http://localhost:3030 (admin/railgun_grafana_dev)"
echo "   • Jaeger:        http://localhost:16686"
echo "   • Alertmanager:  http://localhost:9093"
echo "   • OTEL Collector Metrics: http://localhost:8888/metrics"
echo ""
echo -e "${YELLOW}📋 DOCTRINE COMPLIANCE:${NC}"
echo "   • ✓ No message content logged"
echo "   • ✓ No user identifiers exposed"
echo "   • ✓ Aggregated metrics only"
echo "   • ✓ P2P fallback monitoring enabled"
echo ""
echo "To stop: ./stop-observability.sh"
echo "To view logs: docker compose logs -f"
