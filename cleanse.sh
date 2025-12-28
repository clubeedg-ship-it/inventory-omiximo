#!/bin/bash
# ============================================================================
# PHASE 0: THE CLEANSE
# Complete removal of InvenTree Docker artifacts for a clean slate
# ============================================================================

set -e

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║           PHASE 0: THE CLEANSE - NUKE AND REBUILD                  ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""

# Step 1: Stop all InvenTree containers
echo "🛑 [1/5] Stopping all InvenTree containers..."
docker ps -a --filter "name=inventree" --format "{{.Names}}" | xargs -r docker stop 2>/dev/null || true
docker ps -a --filter "name=inventory" --format "{{.Names}}" | xargs -r docker stop 2>/dev/null || true
echo "   ✓ Containers stopped"

# Step 2: Remove InvenTree containers
echo "🗑️  [2/5] Removing InvenTree containers..."
docker ps -a --filter "name=inventree" --format "{{.Names}}" | xargs -r docker rm -f 2>/dev/null || true
docker ps -a --filter "name=inventory" --format "{{.Names}}" | xargs -r docker rm -f 2>/dev/null || true
echo "   ✓ Containers removed"

# Step 3: Remove InvenTree images
echo "🖼️  [3/5] Removing InvenTree Docker images..."
docker images --filter "reference=*inventree*" --format "{{.Repository}}:{{.Tag}}" | xargs -r docker rmi -f 2>/dev/null || true
docker images --filter "reference=*postgres*" --format "{{.Repository}}:{{.Tag}}" | xargs -r docker rmi -f 2>/dev/null || true
docker images --filter "reference=*redis*" --format "{{.Repository}}:{{.Tag}}" | xargs -r docker rmi -f 2>/dev/null || true
echo "   ✓ Images removed"

# Step 4: Remove InvenTree volumes
echo "💾 [4/5] Removing Docker volumes..."
docker volume ls --filter "name=inventree" --format "{{.Name}}" | xargs -r docker volume rm -f 2>/dev/null || true
docker volume ls --filter "name=inventory" --format "{{.Name}}" | xargs -r docker volume rm -f 2>/dev/null || true
# Force prune unused volumes
docker volume prune -f 2>/dev/null || true
echo "   ✓ Volumes removed"

# Step 5: Remove local InvenTree directory if exists
echo "📁 [5/5] Cleaning local InvenTree directories..."
if [ -d "./inventree-data" ]; then
    rm -rf ./inventree-data
    echo "   ✓ Removed ./inventree-data"
fi
if [ -d "./data" ]; then
    rm -rf ./data
    echo "   ✓ Removed ./data"
fi
echo "   ✓ Local directories cleaned"

echo ""
echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║                    ✅ CLEANSE COMPLETE                             ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Verification commands:"
echo "  docker ps -a | grep inventree    # Should return empty"
echo "  docker images | grep inventree   # Should return empty"
echo "  docker volume ls | grep invent   # Should return empty"
echo ""
echo "Ready for Phase 1: The Backend"
