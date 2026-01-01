#!/bin/bash
# ============================================================================
# OMIXIMO INVENTORY OS - Quick Refresh Script
# Rebuilds and restarts Docker containers while preserving all data volumes
# ============================================================================

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     OMIXIMO INVENTORY OS - Container Refresh               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

cd "$(dirname "$0")"

# Frontend only (fast refresh)
if [ "$1" == "--frontend" ] || [ "$1" == "-f" ]; then
    echo -e "${YELLOW}→ Rebuilding frontend only...${NC}"
    docker-compose up -d --build inventree-frontend
    echo -e "${GREEN}✓ Frontend refreshed!${NC}"
    exit 0
fi

# Full refresh (all containers)
echo -e "${YELLOW}→ Rebuilding all containers (preserving data volumes)...${NC}"
docker-compose up -d --build

echo ""
echo -e "${GREEN}✓ All containers refreshed!${NC}"
echo -e "${GREEN}✓ Volumes and data preserved${NC}"
echo ""
echo -e "${BLUE}Access the app at: http://localhost:1441${NC}"
echo ""

# Show container status
docker-compose ps
