# Project: Omiximo Inventory OS

Last Updated: 2026-01-11 20:45:00 UTC

---

## Project Overview

- **Purpose:** High-performance, keyboard-first inventory management system for a computer assembly business. Replaces the default InvenTree UI with a "Headless" Single Page Application (SPA) optimized for barcode scanners and warehouse operations.
- **Tech Stack:** Vanilla ES6+ JavaScript (No frameworks), CSS3 with custom properties, InvenTree (Django/Python) backend, PostgreSQL, Redis, Docker
- **Architecture:** Headless SPA + Dockerized Microservices (Frontend nginx container + Backend InvenTree container stack)
- **Status:** Alpha (v0.9.0) - Active Development (Phase 5 Complete)
- **Philosophy:**
  1. **Speed is Feature #1:** Zero build steps, instant load times, raw API calls
  2. **Swiss Sci-Fi Aesthetic:** "Braun electronics from 2077" - deep teal (#005066), glassmorphism, strict grid alignments
  3. **Hardware First:** Optimized for NetumScan barcode scanners (Keyboard Wedge mode)

---

## MCP Tools Integration

**CRITICAL: Always utilize available MCP (Model Context Protocol) tools for enhanced capabilities.**

### Available MCP Servers

#### Context7 - Library Documentation
**When to use:** Getting up-to-date documentation for any library or framework

**Available Tools:**
- `mcp__context7__resolve-library-id` - Convert library name to Context7 ID
- `mcp__context7__get-library-docs` - Fetch comprehensive documentation

**Usage Pattern:**
```markdown
1. User asks about a library/framework (e.g., "How do I use Chart.js?")
2. ALWAYS use resolve-library-id first: libraryName="chart.js"
3. Then use get-library-docs with the returned ID
4. Use mode="code" for API/examples, mode="info" for concepts
```

**Project-Specific Examples:**
- Chart.js (for profit charts): resolve-library-id("chart.js") -> get-library-docs
- InvenTree API: resolve-library-id("inventree") -> get-library-docs
- JsBarcode (for labels): resolve-library-id("jsbarcode") -> get-library-docs

**When to ALWAYS use:**
- Working with Chart.js profit visualizations
- Implementing new InvenTree API endpoints
- Barcode/label generation with JsBarcode
- Any library-specific debugging

#### Sequential Thinking - Complex Problem Solving
**When to use:** Breaking down complex problems with multi-step reasoning

**Available Tools:**
- `mcp__sequential-thinking__sequentialthinking` - Chain of thought reasoning

**When to ALWAYS use:**
- FIFO cost calculation logic
- Inventory valuation debugging
- Multi-step barcode scanning workflows
- Complex state management issues
- Performance optimization analysis

#### Playwright - Browser Automation
**When to use:** Testing web applications, screenshots, UI automation

**Available Tools:**
- `mcp__playwright__browser_navigate` - Navigate to URLs
- `mcp__playwright__browser_snapshot` - Capture accessibility tree
- `mcp__playwright__browser_click` - Click elements
- `mcp__playwright__browser_type` - Type into inputs
- `mcp__playwright__browser_take_screenshot` - Capture visual screenshots

**Project-Specific Usage:**
- Test at http://localhost:1441 (frontend)
- Test InvenTree admin at http://localhost:8000/admin
- Verify Wall grid rendering
- Test barcode scanning simulation (type rapidly + Enter)
- Validate profit engine calculations

---

## Technology Stack

### Frontend
- **Framework:** None - Pure Vanilla ES6+ JavaScript (intentional choice for zero build complexity)
- **Styling:** Custom CSS3 with CSS Custom Properties (CSS Variables) - 3,330 lines
- **State Management:** Custom JavaScript objects (`state`, `profitState`) + localStorage
- **UI Components:** Custom glassmorphism components, no component library
- **Build Tool:** None - No bundler, no transpiler, direct browser execution
- **Charts:** Chart.js 4.4.1 (CDN)
- **Fonts:** Inter (Google Fonts)

### Backend (InvenTree)
- **Runtime:** Python (Django) via InvenTree Docker image
- **Framework:** InvenTree (stable) - Open source inventory management
- **Database:** PostgreSQL 15 (Alpine)
- **Cache:** Redis 7 (Alpine)
- **API Style:** REST API at `/api/` (proxied through nginx)
- **Background Tasks:** Celery (inventree-worker container)

### Infrastructure
- **Deployment:** Docker Compose (local development)
- **Containerization:**
  - `inventree-frontend` - nginx:alpine serving static files
  - `inventree-server` - InvenTree Django app
  - `inventree-worker` - Celery background worker
  - `inventree-db` - PostgreSQL 15
  - `redis` - Redis 7 cache
- **Networking:** Custom Docker bridge network (`inventree_network`)
- **Volumes:** `inventree_db_data`, `inventree_data` (persistent)

### Development Tools
- **Package Manager:** None for frontend; pip for Python seed scripts
- **Version Control:** Git, GitHub (clubeedg-ship-it/inventory-omiximo)
- **Code Quality:** No linters configured (vanilla JS)
- **Testing:** Manual testing, Playwright for E2E

---

## Architecture Overview

### Design Patterns
- **Headless CMS Pattern:** InvenTree as API-only backend, custom frontend
- **Module Pattern:** Each JS file exports a single object (`api`, `router`, `wall`, `scanner`, `profitEngine`, etc.)
- **Observer Pattern:** DOM event listeners for scanner input, navigation
- **FIFO (First-In-First-Out):** For inventory cost calculation in profit engine

### Key Components

**Frontend Modules (`/frontend/`):**
- **`app.js`** (2,668 lines): Core router, auth, API client, wall grid, scanner listener, catalog
- **`profit.js`** (825 lines): Profit engine with FIFO calculation, Chart.js rendering, inventory valuation
- **`tenant.js`** (296 lines): Multi-tenant context switching, tenant CRUD, user assignment
- **`labels.js`** (192 lines): Barcode generation (JsBarcode), label printing
- **`env.js`** (5 lines): Runtime environment configuration
- **`index.html`** (651 lines): Single entry point with all view templates
- **`style.css`** (3,330 lines): Swiss Sci-Fi design system with glassmorphism

**Backend (InvenTree):**
- Parts management (`/api/part/`)
- Stock tracking (`/api/stock/`)
- Locations (`/api/stock/location/`)
- User authentication (`/api/user/`)

### Data Flow
```
[Barcode Scan] -> [Global Keypress Listener] -> [Scanner Module] -> [API Client]
                                                        |
[Wall Grid] <-- [DOM Update] <-- [State Update] <-- [InvenTree API]
                                                        |
[Profit Engine] <-- [FIFO Calculation] <-- [Stock/Transaction Data]
```

### Directory Structure
```
omiximo-inventory/
├── frontend/                  # Static frontend files
│   ├── index.html            # Single entry point (SPA)
│   ├── app.js                # Core application logic
│   ├── profit.js             # Profitability engine
│   ├── tenant.js             # Multi-tenant module
│   ├── labels.js             # Label printing
│   ├── env.js                # Runtime config
│   ├── style.css             # Complete styling
│   ├── Dockerfile            # nginx:alpine container
│   ├── nginx.conf            # Proxy config for API
│   └── entrypoint.sh         # Container startup
├── docker-compose.yml        # Full stack orchestration
├── .env                      # Environment variables
├── .env.example              # Template for env vars
├── install.sh                # One-line installer script
├── refresh.sh                # Container rebuild helper
├── cleanse.sh                # Cleanup script
├── reset_admin.sh            # Admin password reset
├── seed_categories.py        # Python: Create part categories
├── seed_locations.py         # Python: Create storage locations
├── seed_parts.js             # Node: Seed test parts
├── benchmark_api.js          # Node: API performance testing
├── verify_pagination.js      # Node: Pagination testing
├── requirements.txt          # Python dependencies (requests)
├── HANDOFF.md               # Developer documentation
└── CLAUDE.md                # This file
```

---

## Development Commands

### Setup
```bash
# Clone repository
git clone https://github.com/clubeedg-ship-it/inventory-omiximo.git
cd omiximo-inventory

# Or use one-line installer
curl -sSL https://raw.githubusercontent.com/clubeedg-ship-it/inventory-omiximo/main/install.sh | bash

# Environment setup
cp .env.example .env
# Edit .env with your credentials

# Start all containers
docker compose up -d

# Seed categories (after containers are running)
pip install -r requirements.txt
python seed_categories.py

# Seed locations
python seed_locations.py
```

### Development
```bash
# Start full stack
docker compose up -d

# Rebuild frontend only (fast - no data loss)
./refresh.sh --frontend
# or
./refresh.sh -f

# Rebuild all containers (preserves volumes)
./refresh.sh

# View logs
docker compose logs -f inventree-frontend
docker compose logs -f inventree-server

# Access the application
# Frontend: http://localhost:1441
# InvenTree Admin: http://localhost:8000/admin
```

### Testing
```bash
# Simulate barcode scan
# In browser, type rapidly on keyboard then press Enter
# Example: PART-123<Enter>

# API benchmark
node benchmark_api.js

# Verify pagination
node verify_pagination.js

# Manual E2E testing via Playwright MCP tools
# Use mcp__playwright__browser_navigate to http://localhost:1441
```

### Container Management
```bash
# Check container status
docker compose ps

# Restart specific container
docker compose restart inventree-frontend

# Stop all containers
docker compose down

# Stop and remove volumes (WARNING: deletes data)
docker compose down -v

# Reset admin password
./reset_admin.sh

# Full cleanup
./cleanse.sh
```

---

## Agent Dispatch History

### 2026-01-11 (Evening) - localStorage Migration & 2-Column Grid Layout (CRITICAL FIX)
- **Agents Used:**
  - orchestrator (root cause analysis and implementation)
- **Skills Used:** None
- **MCP Tools Used:**
  - Playwright browser automation for diagnostics and testing
- **Outcome:** ✅ Fixed critical localStorage corruption issue and implemented 2-column grid layout
- **Implementation Details:**
  - **localStorage Migration System:**
    - Added version-based migration with `omiximo_zone_version` = '2'
    - Migration automatically clears incompatible pre-Phase 5 zone data
    - Auto-restores default zones A & B after migration
    - Runs once per browser (checks version before migrating)
  - **2-Column Grid Layout:**
    - Implemented automatic 2-column grid with wrapping
    - Row calculation: `Math.floor(zoneIndex / 2)` (zones 0-1 in row 0, 2-3 in row 1, etc.)
    - Column calculation: `zoneIndex % 2` (alternates 0, 1, 0, 1...)
    - Auto-correction on init() fixes existing zones with incorrect positions
- **Bugs Fixed:**
  1. **Empty grid after hard refresh** - localStorage had incompatible old format lacking isActive/layoutRow/layoutCol
  2. **Migration not restoring defaults** - Initial migration cleared data but didn't immediately restore zones A & B
  3. **3 zones in one row** - Zone addition hardcoded layoutRow: 0, causing horizontal overflow
- **Files Modified:**
  - `/frontend/app.js` - Migration logic in zoneConfig.init() (lines 624-669), 2-column layout in zoneManager (lines 839-853), v15→v17
  - `/frontend/index.html` - Cache buster updates v14→v15→v16→v17
- **Testing:**
  - Created `/tmp/test_migration.js` - Verified old localStorage migration
  - Created `/tmp/test_user_scenario.js` - Full user scenario test with persistent context
  - Created `/tmp/test_layout_fix.js` - Verified 3-zone layout correction
  - Playwright confirmed migration works and grid renders correctly
- **Learnings:**
  - Hard refresh clears HTTP cache but NOT localStorage (critical UX insight)
  - Migration must restore defaults immediately, not rely on subsequent load()
  - Mathematical grid positioning (modulo & floor division) more robust than hardcoding
- **Duration:** 2 hours
- **Status:** CRITICAL BUG RESOLVED ✅

### 2026-01-11 (Afternoon) - Phase 5 Dynamic Zone System Implementation (COMPLETE)
- **Agents Used:**
  - orchestrator (coordination and bug fixing)
  - sequential-thinking (root cause analysis)
- **Skills Used:** None
- **MCP Tools Used:**
  - Playwright browser automation for testing and verification
  - Sequential Thinking for debugging initialization race condition
- **Outcome:** ✅ Phase 5 fully implemented and tested - Dynamic zone configuration system operational
- **Implementation Details:**
  - Added `zoneConfig` module for CRUD operations with localStorage persistence
  - Added `zoneManager` module for UI interactions (modals, validation)
  - Refactored `wall.render()` to support unlimited dynamic zones (A-Z)
  - Added zone configuration modal with templates (Small 3×5, Standard 4×7, Large 6×10)
  - Added zone deletion modal with emergency warning and confirmation
  - Implemented hybrid layout system for zones (side-by-side rows)
  - Auto-suggestion feature: pre-fills next available zone letter with help text
- **Bugs Fixed:**
  1. Static HTML blocking dynamic rendering (removed hardcoded Zone A/B headers)
  2. Missing icons.js reference (404 error)
  3. Initialization race condition causing blank page (fixed async/await sequence)
  4. wall.loadLiveData() using hardcoded zones (refactored to use state.zones)
  5. Poor UX for zone naming (added auto-suggest with existing zones display)
- **Files Modified:**
  - `/frontend/app.js` - Added zoneConfig (lines 616-720), zoneManager (lines 728-863), refactored wall.render() (lines 852-891), fixed wall.loadLiveData() (lines 1120-1183), fixed initialization (lines 3567-3573), v14
  - `/frontend/index.html` - Removed static wall HTML, added zone modals (lines 536-599), removed icons.js reference, v14
  - `/frontend/style.css` - Added ~250 lines of zone system CSS (lines 4000-4250), v8
- **Testing:**
  - Playwright automated testing confirmed all features working
  - Zone name pre-filled with "C" (next available)
  - Help text shows "Existing zones: A, B. Suggested: C"
  - Stock items displaying correctly (10, 5, 3 units visible)
  - Add Zone button visible and functional
- **Learnings:**
  - User demanded deep analysis before fixes (sequential-thinking invaluable)
  - Initialization order critical: must await init() before auth.init()
  - Auto-suggestion significantly improves UX vs error messages
- **Duration:** 4 hours
- **Status:** Phase 5 COMPLETE ✅ - Ready for Phase 6

### 2026-01-11 - Phase 5 Zone Configuration Bug Fix
- **Agents Used:**
  - orchestrator (root cause analysis and fix implementation)
- **Skills Used:** None
- **MCP Tools Used:** None
- **Outcome:** Fixed wall.loadLiveData() to use dynamic state.zones instead of hardcoded CONFIG values
- **Learnings:**
  - Phase 5 refactoring removed CONFIG.COLUMNS and CONFIG.LEVELS
  - wall.render() was updated but wall.loadLiveData() was not
  - Cell DOM lookup needed to use `data-cell-id` attribute selector
- **Files Modified:**
  - `/frontend/app.js` - lines 1120-1160 (loadLiveData function)
  - `/frontend/index.html` - cache buster version increment (v11 -> v12)
- **Duration:** 30 minutes

### 2026-01-11 - Project Analysis and CLAUDE.md Update
- **Agents Used:**
  - orchestrator (project analysis and documentation)
- **Skills Used:** None
- **MCP Tools Used:** None
- **Outcome:** Comprehensive CLAUDE.md created with full project documentation
- **Learnings:** Project uses intentional "no-framework" approach for speed
- **Duration:** 15 minutes

### 2026-01-10 - Inventory Valuation Bug Fix
- **Agents Used:**
  - debugger (root cause analysis)
  - frontend-developer (fix implementation)
- **Skills Used:** None
- **MCP Tools Used:** Sequential Thinking for debugging
- **Outcome:** Fixed inventory value showing as 0.00, now uses client-side joining with `state.parts`
- **Learnings:** Stock batches need to be joined with parts data on the client side

### 2026-01-02 - Race Condition Fix
- **Agents Used:**
  - debugger (race condition identification)
- **Outcome:** Fixed race condition by loading parts before initializing Profit Engine

---

## Recent Decisions

### 2026-01-11 (Evening) - localStorage Migration Pattern for Breaking Changes
- **Context:** Phase 5 changed localStorage structure, causing empty grid for existing users despite hard refresh
- **Decision:** Implement version-based migration system with automatic data restoration
- **Rationale:**
  - Hard refresh only clears HTTP cache, not localStorage (users don't know this)
  - Incompatible data structures cause silent failures (no error messages)
  - Manual localStorage.clear() is too technical for end users
  - Migration must be automatic and transparent
- **Implementation:**
  - Store `omiximo_zone_version` = '2' in localStorage
  - On init, check if stored version matches current version
  - If mismatch: clear old data, restore defaults, save new version
  - Skip redundant load() after migration (early return)
  - Auto-correct any existing zones with wrong layout positions
- **Impact:**
  - Users upgrading from pre-Phase 5 automatically get working grid
  - No manual intervention required
  - Future breaking changes can use version '3', '4', etc.
  - Establishes pattern for all localStorage schema changes

### 2026-01-11 (Evening) - 2-Column Grid Layout with Mathematical Positioning
- **Context:** Adding Zone C placed it horizontally alongside A & B, making layout too wide
- **Decision:** Implement 2-column grid with automatic wrapping using modulo arithmetic
- **Rationale:**
  - User explicitly requested "maximum should be 2, anything else goes underneath"
  - Hardcoded positions (layoutRow: 0, layoutCol: length) don't scale
  - Mathematical formulas are self-correcting and predictable
  - Works for unlimited zones (A-Z and beyond)
- **Implementation:**
  - Row position: `Math.floor(zoneIndex / 2)` (integer division)
  - Column position: `zoneIndex % 2` (modulo 2)
  - Results: Zone 0→(0,0), Zone 1→(0,1), Zone 2→(1,0), Zone 3→(1,1), etc.
  - Add auto-correction on init() to fix existing zones
- **Impact:**
  - Grid always displays 2 columns maximum
  - New zones automatically wrap to next row
  - Page width stays manageable
  - Layout is consistent and predictable

### 2026-01-11 (Afternoon) - Auto-Suggestion UX for Zone Naming
- **Context:** Users tried to add "Zone A" and received confusing error "Zone A already exists"
- **Decision:** Implement auto-suggestion system that pre-fills next available zone letter
- **Rationale:**
  - Error messages are reactive and frustrating
  - Auto-suggestion is proactive and helpful
  - Showing existing zones provides context
  - Pre-filling saves keystrokes and prevents errors
- **Implementation:**
  - Calculate next available letter from A-Z alphabet
  - Pre-fill zone name input field with suggestion
  - Update help text to show: "Existing zones: A, B. Suggested: C"
  - User can still override if they want to skip letters
- **Impact:**
  - Eliminates confusion about which zones exist
  - Reduces errors from duplicate zone names
  - Improves first-time user experience
  - Maintains flexibility for custom naming

### 2026-01-11 - Initialization Sequence for Zone System
- **Context:** Frontend showed blank page after Phase 5 implementation
- **Decision:** Make DOMContentLoaded async and sequential: await init() then await auth.init()
- **Rationale:**
  - init() creates DOM structure (wall.render() generates cells)
  - auth.init() populates data into those cells (wall.loadLiveData())
  - Running in parallel caused race condition where loadLiveData() executed before cells existed
- **Impact:**
  - UI now renders correctly on every page load
  - No more blank screens
  - All async operations properly sequenced

### 2026-01-11 - Dynamic Zone Configuration for Wall Data Loading
- **Context:** Phase 5 zone configuration refactoring broke wall.loadLiveData()
- **Decision:** Refactor loadLiveData() to iterate over state.zones using zoneConfig.getAllZones()
- **Rationale:**
  - wall.render() already uses zoneConfig.getAllZones() for dynamic zone rendering
  - loadLiveData() still used hardcoded `['A', 'B']` and non-existent CONFIG.COLUMNS/CONFIG.LEVELS
  - DOM cell lookup used `document.getElementById()` but cells have `data-cell-id` attributes
- **Impact:**
  - Stock data now loads correctly for all dynamically configured zones
  - Cell loading/unloading visual states work correctly
  - No breaking changes to existing functionality

### 2026-01-10 - Client-Side Data Joining for Inventory Valuation
- **Context:** Inventory value was showing as 0.00 because stock items don't include part pricing
- **Decision:** Join stock data with `state.parts` Map on the client side
- **Rationale:** InvenTree API returns stock items without embedded part details; joining in JS is simpler than API changes
- **Impact:** Inventory valuation now works correctly; requires parts to be loaded before profit engine renders

### 2026-01-10 - Browser Cache Busting Strategy
- **Context:** Users seeing stale JavaScript after updates
- **Decision:** Implement version query strings on script tags (`?v=5`)
- **Rationale:** Simple, no build step required, immediate cache invalidation
- **Impact:** All script tags in index.html now have version numbers; must increment on changes

### Original - No Framework Architecture
- **Context:** Need for fastest possible load and response times
- **Decision:** Pure vanilla ES6+ JavaScript, no React/Vue/Angular
- **Rationale:**
  - Zero build step means instant deploy
  - No framework overhead
  - Direct DOM manipulation for maximum speed
  - Keyboard/barcode scanner optimization
- **Impact:** ~8,000 lines of hand-written JS/CSS; all state management is custom

---

## Established Patterns & Conventions

### Code Style
- **Module Pattern:** Each file exports a single global object
  - `const api = { ... }` for API client
  - `const router = { ... }` for navigation
  - `window.moduleName = moduleName` for global exposure
- **Async/Await:** All API calls use async/await pattern
- **DOM Helpers:** `$(id)` for getElementById, `$$(sel)` for querySelectorAll
- **Console Logging:** Emoji prefixes for log types
  - `console.log('Loading...')` with emoji indicators

### Component Patterns
- **View Templates:** All view HTML lives in index.html with `class="view"`
- **Hidden by Default:** Views use `.active` class for visibility
- **Modal Pattern:** Modals use `.modal-overlay.active` pattern

### API Patterns
- **RESTful:** All endpoints follow `/api/endpoint/` pattern
- **Token Auth:** `Authorization: Token <token>` header
- **Paginated Responses:** DRF style `{ count, next, previous, results }`
- **Tenant Filtering:** Query params for multi-tenant filtering

### State Management
- **Global State Object:** `const state = { ... }` in app.js
- **Map for Lookups:** `state.locations = new Map()` for O(1) lookups
- **LocalStorage Persistence:**
  - `omiximo_view` - current view
  - `omiximo_tenant` - tenant context
  - `omiximo_transactions` - transaction history
  - `omiximo_zones` - dynamic zone configuration (Phase 5+)
  - `omiximo_zone_version` - migration version tracker (currently '2')
  - `theme` - dark/light mode

### Error Handling
- **Try-Catch Blocks:** All async functions wrapped
- **Toast Notifications:** `toast.show(message, type)` for user feedback
- **Console Warnings:** `console.warn()` for non-critical issues

---

## Known Issues & Solutions

### Scanner Focus Duplication
- **Problem:** If an input field is focused, global scanner listener may duplicate characters
- **Symptoms:** Scanned barcode appears twice or is malformed
- **Solution:** Scanner handler checks `e.target.tagName` and ignores INPUT/SELECT/TEXTAREA
- **Prevention:** Don't focus inputs during scan operations

### Chart Data Loss on LocalStorage Clear
- **Problem:** Historical profit data is lost when localStorage is cleared
- **Symptoms:** Empty charts, no transaction history
- **Solution:** Planned - persist to InvenTree custom model or external database
- **Prevention:** Educate users not to clear browser data; implement backup

### Inventory Value Shows 0.00
- **Problem:** Stock items don't include part pricing data
- **Symptoms:** Inventory breakdown shows correct quantities but 0.00 values
- **Solution:** Join stock data with `state.parts` Map client-side (fixed Jan 2026)
- **Prevention:** Always ensure parts are loaded before rendering profit engine

### Double API Calls on Init
- **Problem:** Parts/locations fetched multiple times during initialization
- **Symptoms:** Slow initial load, redundant API calls
- **Solution:** Race condition fix - load parts before profit engine init (fixed Jan 2026)
- **Prevention:** Establish clear initialization order in `initApp()`

### Wall Data Not Loading After Zone Refactoring (RESOLVED)
- **Problem:** Phase 5 zone configuration broke wall.loadLiveData()
- **Symptoms:** Wall grid renders correctly but shows no stock data (all cells empty/dashes)
- **Solution:** Refactored loadLiveData() to use zoneConfig.getAllZones() instead of hardcoded values (fixed Jan 11, 2026)
- **Prevention:** When refactoring zone configuration, update ALL functions that iterate over zones

### Empty Grid After localStorage Schema Change (RESOLVED)
- **Problem:** Phase 5 changed localStorage schema, causing empty grid for existing users
- **Symptoms:** "No zones configured" message despite hard refresh, zones exist in localStorage but with old format
- **Root Cause:** Hard refresh clears HTTP cache but NOT localStorage; old data lacking isActive/layoutRow/layoutCol fields
- **Solution:** Implemented version-based migration system with `omiximo_zone_version` (fixed Jan 11, 2026 evening)
- **Prevention:** Always use migration pattern for localStorage schema changes; increment version number for breaking changes

---

## Skills Configuration

### Active Skills
- **webapp-testing:** Use Playwright MCP tools to test at http://localhost:1441
- **api-documenter:** Document InvenTree API endpoints used by frontend

### Skill Usage Notes
- **webapp-testing:** Access app at port 1441, simulate barcode by typing rapidly then Enter
- **artifacts-builder:** Not needed - frontend is vanilla JS, not React

### Recommended Skills for Common Tasks
```
Task                          -> Recommended Skill
-----------------------------------------------------
Test Wall grid rendering      -> webapp-testing (Playwright)
Debug FIFO calculation        -> Sequential Thinking MCP
Add new API endpoint          -> Context7 for InvenTree docs
Generate labels               -> JsBarcode docs via Context7
Analyze profit logic          -> Sequential Thinking MCP
```

---

## Security & Authentication

### Authentication Strategy
- **Method:** Token-based authentication via InvenTree
- **Token Storage:** In-memory (`CONFIG.API_TOKEN`) during session
- **Credentials:** Basic auth on login, token returned for subsequent requests
- **Session:** Token persists until page refresh

### Security Measures
- **CORS:** `INVENTREE_CORS_ORIGIN_ALLOW_ALL=True` for development
- **API Proxy:** Frontend nginx proxies `/api/` to backend (no direct DB access)
- **Input Validation:** InvenTree backend handles validation

### Environment Variables
```bash
# Database
INVENTREE_DB_ENGINE=postgresql
INVENTREE_DB_NAME=inventree
INVENTREE_DB_USER=inventree
INVENTREE_DB_PASSWORD=inventree_secret_2024

# Redis
INVENTREE_CACHE_HOST=redis
INVENTREE_CACHE_PORT=6379

# Django
INVENTREE_DEBUG=True
INVENTREE_SECRET_KEY=lean-inventory-secret-key-change-in-production

# Admin (for initial setup)
INVENTREE_ADMIN_USER=admin
INVENTREE_ADMIN_PASSWORD=admin123
INVENTREE_ADMIN_EMAIL=admin@inventory.local

# Frontend
FRONTEND_PORT=1441
```

---

## Testing Strategy

### Manual Testing
- **Location:** Browser at http://localhost:1441
- **Coverage:** All views (Wall, Catalog, Profit), barcode scanning, modals

### API Testing
- **Tool:** `benchmark_api.js`, `verify_pagination.js`
- **Coverage:** Pagination, response times, endpoint availability

### E2E Testing
- **Tool:** Playwright via MCP tools
- **Coverage:** Navigation, form submission, barcode simulation
- **MCP Integration:** Use `mcp__playwright__*` tools for browser automation

### Test Conventions
- **Barcode Simulation:** Type rapidly (within 100ms between chars) then Enter
- **Expected Behaviors:** Toast notifications, modal openings, grid updates

---

## Performance Considerations

### Known Bottlenecks
- **Wall Data Loading:** Fetches stock for each cell sequentially
- **Parts Pagination:** Large catalogs require multiple API calls

### Optimization Patterns
- **Pagination Limiting:** Default limit of 50 parts per request
- **Map Lookups:** `state.locations.get(id)` for O(1) access
- **Scan Timeout:** 100ms buffer for barcode scanner detection
- **Polling Interval:** 30 second refresh for stock data

### Caching Strategy
- **LocalStorage:** View state, tenant context, transactions
- **No HTTP Caching:** Development mode, cache-busting query strings
- **Redis (Backend):** InvenTree session and cache storage

---

## Next Steps

**Immediate (This Week):**
- [ ] Persist profit/transaction data to database (not just localStorage)
- [ ] Connect label printing to actual printer (ZPL or Brother)

**Short Term (This Month):**
- [ ] Add user permission restrictions for Profit Engine
- [ ] Implement batch timeline view (lifecycle tracking)

**Long Term (This Quarter):**
- [ ] Supplier integration for auto-PO generation
- [ ] WebSocket for real-time stock updates
- [ ] Mobile-responsive design improvements

**Backlog:**
- [ ] Unit test suite
- [ ] CI/CD pipeline
- [ ] Production deployment configuration
- [ ] Multi-language support

---

## Additional Resources

### Documentation
- **InvenTree API:** https://docs.inventree.org/en/latest/api/api/
- **Chart.js:** https://www.chartjs.org/docs/latest/
- **JsBarcode:** https://github.com/lindell/JsBarcode

### Related Repositories
- **InvenTree:** https://github.com/inventree/InvenTree
- **This Project:** https://github.com/clubeedg-ship-it/inventory-omiximo

### Key References
- HANDOFF.md in this repository for detailed developer documentation
- docker-compose.yml for full infrastructure configuration

---

## Project-Specific Notes

### Important Quirks
- **No Package.json:** This is intentional - frontend has no dependencies to install
- **Version Query Strings:** Script tags use `?v=N` for cache busting - must increment manually
- **Global Objects:** All modules attach to window for cross-file access

### Local Development Tips
- Use `./refresh.sh -f` for fast frontend-only rebuilds
- Check `docker compose logs -f inventree-server` for API errors
- Default login is admin/admin123
- Barcode scanner simulation: type fast then Enter

### Common Gotchas
- **CORS Issues:** Make sure INVENTREE_CORS_ORIGIN_ALLOW_ALL is True
- **Empty Wall:** Seed locations first with `python seed_locations.py`
- **API 401:** Token may have expired, refresh the page to re-authenticate
- **Profit Data Lost:** Check localStorage wasn't cleared

---

## Changelog

### 2026-01-11 (Evening) - localStorage Migration & Grid Layout Fix 🔧
- **Added: localStorage Migration System**
  - Version-based migration with `omiximo_zone_version` = '2'
  - Automatic detection and clearing of incompatible pre-Phase 5 data
  - Auto-restoration of default zones A & B after migration
  - One-time migration per browser (version check prevents re-runs)
  - Auto-correction for existing zones with incorrect layout positions
- **Fixed: 2-Column Grid Layout**
  - Maximum 2 zones per row with automatic wrapping to next row
  - Mathematical positioning: row = floor(index/2), col = index%2
  - Zone C now wraps to second row instead of extending first row
  - Layout dynamically fits page width regardless of zone count
- **Fixed: Empty Grid Bug (CRITICAL)**
  - Resolved issue where users saw no grid after hard refresh
  - Root cause: localStorage had old format without isActive/layoutRow/layoutCol
  - Hard refresh clears HTTP cache but NOT localStorage (key learning)
- **Testing: Comprehensive Playwright Verification**
  - test_migration.js - Verified old localStorage format migration
  - test_user_scenario.js - Full user scenario with persistent browser context
  - test_layout_fix.js - Verified 3-zone layout auto-correction
- **Updated:** app.js?v=17, index.html?v=17

### 2026-01-11 (Afternoon) - Phase 5 Complete ✅
- **Added: Dynamic Zone Configuration System**
  - zoneConfig module with localStorage persistence
  - zoneManager module for UI interactions
  - Zone add/edit/delete functionality
  - Zone templates (Small 3×5, Standard 4×7, Large 6×10)
  - Hybrid layout support (side-by-side zones)
  - Auto-suggestion for zone names with help text
- **Fixed: Critical initialization race condition**
  - Made DOMContentLoaded sequential (await init, then await auth.init)
  - Eliminated blank page on load
- **Fixed: wall.loadLiveData() dynamic zone support**
  - Now iterates over state.zones instead of hardcoded ['A', 'B']
  - Uses zone.columns and zone.levels instead of CONFIG values
  - Cell DOM lookups use `data-cell-id` attribute selector
- **Fixed: Static HTML blocking dynamic rendering**
  - Removed hardcoded Zone A/B headers from index.html
  - Removed missing icons.js reference (404)
- **Testing: Full Playwright verification**
  - Zone modal auto-suggests "C" for next zone
  - Help text shows "Existing zones: A, B. Suggested: C"
  - Stock items display correctly (10, 5, 3 units visible)
- **Updated:** app.js?v=14, index.html?v=14, style.css?v=8

### 2026-01-11 (Morning)
- Added: Comprehensive CLAUDE.md documentation
- Fixed: CLAUDE.md now reflects actual project structure

### 2026-01-10
- Fixed: Inventory valuation calculation using state.parts joining
- Fixed: Batch editing render issues
- Added: Browser cache busting with version query strings

### 2026-01-02
- Fixed: Race condition - load parts before profit engine init

### 2025-12-29
- Fixed: UI freeze by limiting rendered items
- Added: Error handling improvements

---

**Last Reviewed:** 2026-01-11
**Maintained By:** Orchestrator Agent + Team
**Version:** 0.9.0 (Alpha - Phase 5 Complete with Migration System)

---

## Using This File

**For Orchestrator Agent:**
- Read this file at the start of EVERY task
- Update relevant sections after completing work
- Use MCP tools as specified in the MCP Integration section
- Document all decisions in Recent Decisions
- Track all agent dispatches in Agent Dispatch History

**For All Agents:**
- Reference this file for project context
- Follow established patterns (Module Pattern, no frameworks)
- Use Context7 for InvenTree/Chart.js/JsBarcode docs
- Update your section after significant work

**For Developers:**
- Keep this file current as the project evolves
- Document new patterns and decisions
- Increment version numbers on script tags when changing JS/CSS
- Review periodically to ensure accuracy
