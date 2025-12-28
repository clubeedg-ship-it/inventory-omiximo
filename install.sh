#!/bin/bash
# =============================================================================
# OMIXIMO INVENTORY OS - One-Line Installer
# Headless InvenTree Backend + Custom Swiss Sci-Fi Frontend
# =============================================================================
# Usage: curl -sSL https://raw.githubusercontent.com/clubeedg-ship-it/inventory-omiximo/main/install.sh | bash
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Banner
echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${NC}                                                                       ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}   ██████╗ ███╗   ███╗██╗██╗  ██╗██╗███╗   ███╗ ██████╗                ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  ██╔═══██╗████╗ ████║██║╚██╗██╔╝██║████╗ ████║██╔═══██╗               ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  ██║   ██║██╔████╔██║██║ ╚███╔╝ ██║██╔████╔██║██║   ██║               ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  ██║   ██║██║╚██╔╝██║██║ ██╔██╗ ██║██║╚██╔╝██║██║   ██║               ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}  ╚██████╔╝██║ ╚═╝ ██║██║██╔╝ ██╗██║██║ ╚═╝ ██║╚██████╔╝               ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}   ╚═════╝ ╚═╝     ╚═╝╚═╝╚═╝  ╚═╝╚═╝╚═╝     ╚═╝ ╚═════╝                ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}                                                                       ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}                    ${GREEN}I N V E N T O R Y   O S${NC}                           ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}              ${BLUE}Swiss Sci-Fi Warehouse Management${NC}                      ${CYAN}║${NC}"
echo -e "${CYAN}║${NC}                                                                       ${CYAN}║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# -----------------------------------------------------------------------------
# Prerequisites Check & Auto-Cleanup
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[1/6]${NC} Checking system..."

# Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}✗ Docker not found. Please install Docker first.${NC}"
    exit 1
fi

# Docker Compose
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
elif command -v docker-compose &> /dev/null; then
    COMPOSE_CMD="docker-compose"
else
    echo -e "${RED}✗ Docker Compose not found.${NC}"
    exit 1
fi

# Check for conflicting containers and stop them
echo -e "  Checking for existing InvenTree containers..."
EXISTING_CONTAINERS=$(docker ps -a --filter "name=inventree-" --format "{{.ID}}")

if [ ! -z "$EXISTING_CONTAINERS" ]; then
    echo -e "  ${YELLOW}⚠${NC} Found existing containers. Stopping and removing them..."
    docker stop $EXISTING_CONTAINERS 2>/dev/null || true
    docker rm $EXISTING_CONTAINERS 2>/dev/null || true
    echo -e "  ${GREEN}✓${NC} Cleaned up existing containers"
else
    echo -e "  ${GREEN}✓${NC} Port 8000 clear"
fi

# -----------------------------------------------------------------------------
# Directory Setup (Smart Update)
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[2/6]${NC} Setting up installation directory..."

INSTALL_DIR="${INSTALL_DIR:-$PWD/omiximo-inventory}"

if [ -d "$INSTALL_DIR" ]; then
    echo -e "  ${BLUE}ℹ${NC} Directory exists: $INSTALL_DIR"
    cd "$INSTALL_DIR"
    
    if [ -d ".git" ]; then
        echo -e "  Updating repository..."
        git pull --quiet || echo -e "  ${YELLOW}⚠${NC} Git pull failed (local changes?), proceeding anyway."
    else
        echo -e "  ${YELLOW}⚠${NC} Not a git repo. Proceeding with existing files."
    fi
else
    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    echo -e "  ${GREEN}✓${NC} Created: $INSTALL_DIR"
    
    # Clone
    REPO_URL="${REPO_URL:-https://github.com/clubeedg-ship-it/inventory-omiximo.git}"
    if command -v git &> /dev/null; then
        echo "  Cloning repository..."
        git clone --depth 1 "$REPO_URL" . 2>/dev/null || {
             echo -e "${RED}✗ Git clone failed.${NC}"
             exit 1
        }
    else
        echo -e "${RED}✗ Git is required for initial install.${NC}"
        exit 1
    fi
fi

# -----------------------------------------------------------------------------
# Environment Configuration
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[3/6]${NC} Configuring environment..."

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo -e "  ${GREEN}✓${NC} Created .env from .env.example"
    else
        # Create default .env
        cat > .env << 'EOF'
INVENTREE_DB_ENGINE=postgresql
INVENTREE_DB_NAME=inventree
INVENTREE_DB_USER=inventree
INVENTREE_DB_PASSWORD=inventree_secret_2024
INVENTREE_DB_HOST=inventree-db
INVENTREE_DB_PORT=5432
INVENTREE_CACHE_HOST=redis
INVENTREE_CACHE_PORT=6379
INVENTREE_DEBUG=True
INVENTREE_SECRET_KEY=lean-inventory-secret-key
INVENTREE_API_ENABLED=True
INVENTREE_CORS_ORIGIN_ALLOW_ALL=True
INVENTREE_ADMIN_USER=admin
INVENTREE_ADMIN_PASSWORD=admin123
INVENTREE_ADMIN_EMAIL=admin@inventory.local
INVENTREE_PLUGINS_ENABLED=True
INVENTREE_TIMEZONE=Europe/Amsterdam
INVENTREE_AUTO_UPDATE=True
INVENTREE_AUTO_MIGRATE=True
EOF
        echo -e "  ${GREEN}✓${NC} Created default .env"
    fi
else
    echo -e "  ${GREEN}✓${NC} .env already exists"
fi

# -----------------------------------------------------------------------------
# Docker Stack Launch
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[4/6]${NC} Starting Docker containers..."

# Ensure we pull the latest images
# $COMPOSE_CMD pull -q

$COMPOSE_CMD down 2>/dev/null || true
$COMPOSE_CMD up -d

echo -e "  ${GREEN}✓${NC} Containers started"

# -----------------------------------------------------------------------------
# Wait for InvenTree to be healthy
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[5/6]${NC} Waiting for InvenTree to be ready..."

MAX_WAIT=120
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -s http://localhost:8000/api/ > /dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} InvenTree API is ready!"
        break
    fi
    sleep 5
    WAITED=$((WAITED + 5))
    echo -e "  ⏳ Waiting... (${WAITED}s / ${MAX_WAIT}s)"
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "  ${YELLOW}⚠${NC} InvenTree taking longer than expected. Check logs with:"
    echo "       docker logs inventree-server"
fi

# -----------------------------------------------------------------------------
# Seed Database (Locations)
# -----------------------------------------------------------------------------
echo -e "${YELLOW}[6/6]${NC} Seeding warehouse locations..."

# Check Python for seeding
if ! command -v python3 &> /dev/null; then
    echo -e "${YELLOW}⚠ Python3 not found. Seeding step will be skipped.${NC}"
else
    if [ -f "seed_locations.py" ]; then
        # Install requests if needed
        pip3 install requests --quiet 2>/dev/null || true
        
        # Run seeder
        python3 seed_locations.py 2>/dev/null && {
            echo -e "  ${GREEN}✓${NC} Warehouse locations seeded"
        } || {
            echo -e "  ${YELLOW}⚠${NC} Seeding skipped (may already be seeded)"
        }
    fi
fi

# -----------------------------------------------------------------------------
# Start Frontend (optional)
# -----------------------------------------------------------------------------
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║${NC}                    ${GREEN}✅ INSTALLATION COMPLETE${NC}                          ${GREEN}║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${CYAN}BACKEND (InvenTree API):${NC}"
echo -e "  URL:      ${BLUE}http://localhost:8000${NC}"
echo -e "  API:      ${BLUE}http://localhost:8000/api/${NC}"
echo -e "  Admin UI: ${BLUE}http://localhost:8000/admin/${NC}"
echo ""
echo -e "${CYAN}LOGIN CREDENTIALS:${NC}"
echo -e "  Username: ${GREEN}admin${NC}"
echo -e "  Password: ${GREEN}admin123${NC}"
echo ""
echo -e "${CYAN}FRONTEND (Omiximo UI):${NC}"
echo -e "  To start the custom frontend, run:"
echo -e "  ${YELLOW}cd frontend && python3 -m http.server 3001${NC}"
echo -e "  Then open: ${BLUE}http://localhost:3001${NC}"
echo ""
echo -e "${CYAN}USEFUL COMMANDS:${NC}"
echo -e "  View logs:    ${YELLOW}docker logs -f inventree-server${NC}"
echo -e "  Stop stack:   ${YELLOW}docker compose down${NC}"
echo -e "  Restart:      ${YELLOW}docker compose restart${NC}"
echo -e "  Full reset:   ${YELLOW}./cleanse.sh${NC}"
echo ""
