# Architecture Review Report

**Project:** Omiximo Inventory OS
**Date:** 2026-01-11
**Reviewer:** Architecture Reviewer Agent
**Scope:** System Design, Module Structure, Design Patterns, Scalability
**Approach:** Static analysis of frontend architecture and integration patterns

---

## Executive Summary

The Omiximo Inventory OS employs a "Headless SPA" architecture pattern, using vanilla JavaScript to create a custom frontend for the InvenTree inventory management system. While this approach offers simplicity and zero build-step deployment, the current implementation shows signs of organic growth without consistent architectural patterns.

**Overall Architecture Rating: 5/10**

### Architectural Health Summary

| Aspect | Rating | Notes |
|--------|--------|-------|
| Modularity | 4/10 | Monolithic file, implicit dependencies |
| Separation of Concerns | 5/10 | Mixed UI/business logic |
| Scalability | 4/10 | Will struggle beyond current scale |
| Maintainability | 4/10 | High cognitive load |
| Extensibility | 5/10 | Adding features requires modifying core |
| Testability | 3/10 | Tight coupling, global state |

---

## Current Architecture Overview

### System Context

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                          │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Omiximo Frontend SPA                      │ │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │ │
│  │  │ app.js  │ │profit.js│ │tenant.js│ │labels.js│           │ │
│  │  │ (4358)  │ │ (825)   │ │ (296)   │ │ (192)   │           │ │
│  │  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘           │ │
│  │       └──────┬────┴──────┬────┴──────┬────┘                 │ │
│  │              │  Global State (window.*)                     │ │
│  │              └────────────────┬─────────────────────────────│ │
│  └───────────────────────────────┼─────────────────────────────┘ │
│                                  │ HTTP REST                      │
└──────────────────────────────────┼─────────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │      nginx Reverse Proxy     │
                    │      (inventree-frontend)    │
                    └──────────────┬──────────────┘
                                   │ /api/*
                    ┌──────────────▼──────────────┐
                    │    InvenTree Django App      │
                    │    (inventree-server)        │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │       PostgreSQL + Redis     │
                    └─────────────────────────────┘
```

### Module Dependency Graph

```
                    ┌─────────────────┐
                    │   DOMContent    │
                    │    Loaded       │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │     init()      │
                    └────────┬────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
    ┌────▼────┐        ┌─────▼─────┐       ┌─────▼─────┐
    │  theme  │        │  router   │       │ scanner   │
    └─────────┘        └─────┬─────┘       └───────────┘
                             │
         ┌───────────────────┼───────────────────┐
         │                   │                   │
    ┌────▼────┐        ┌─────▼─────┐       ┌─────▼─────┐
    │  wall   │◄───────│   auth    │───────►│  catalog  │
    └────┬────┘        └─────┬─────┘       └─────┬─────┘
         │                   │                   │
         │              ┌────▼─────┐             │
         │              │   api    │◄────────────┘
         │              └────┬─────┘
         │                   │
         └──────────────────►│
                             │
                    ┌────────▼────────┐
                    │  External APIs  │
                    │   (InvenTree)   │
                    └─────────────────┘
```

---

## Architectural Patterns Identified

### 1. Module Pattern (Partial Implementation)

**Current Usage:**
```javascript
const api = {
    request() { ... },
    getParts() { ... },
    // Methods grouped as object properties
};

const router = {
    currentView: null,
    init() { ... },
    navigate() { ... },
};
```

**Strengths:**
- Namespaces functionality
- Encapsulates related methods

**Weaknesses:**
- No private state (everything accessible)
- No dependency injection
- Modules attached to `window` for cross-file access

---

### 2. Observer Pattern (Partial)

**Current Usage:**
```javascript
// DOM event listeners act as observers
document.addEventListener('keydown', (e) => { ... });
dom.catalogSearch.addEventListener('input', (e) => { ... });
```

**Missing:**
- No custom event system for inter-module communication
- No publish/subscribe for state changes

---

### 3. Singleton Pattern (Implicit)

**Current Usage:**
```javascript
// All modules are singletons by default
const state = { ... };  // Single global state
const api = { ... };    // Single API client
const router = { ... }; // Single router
```

**Issue:**
- Cannot instantiate for testing
- No dependency injection possible

---

## Architectural Issues

### ARCH-001: Monolithic Module Structure (CRITICAL)

**Location:** `/frontend/app.js` (4,358 lines, 25+ modules)

**Description:**
All frontend logic resides in a single file, creating:
- High cognitive load
- Merge conflict risks
- No code splitting possible
- Cannot lazy load features

**Current Structure:**
```
app.js (4,358 lines)
├── CONFIG (lines 11-25)
├── state (lines 30-46)
├── dom (lines 51-103)
├── api (lines 109-368)
├── router (lines 373-487)
├── settings (lines 492-598)
├── zoneConfig (lines 616-757)
├── zoneManager (lines 762-914)
├── shelfConfig (lines 919-1060)
├── binInfoModal (lines 1065-1256)
├── wall (lines 1265-1643)
├── scanner (lines 1648-1811)
├── handshake (lines 1816-2528)
├── categoryManager (lines 2533-2597)
├── catalog (lines 2602-2971)
├── batchDetail (lines 2976-3122)
├── batchEditor (lines 3127-3247)
├── partManager (lines 3252-3594)
├── binModal (lines 3599-3623)
├── notifications (lines 3631-3700)
├── alerts (lines 3712-3817)
├── history (lines 3836-4082)
├── auth (lines 4199-4323)
└── init, helpers (various)
```

**Recommended Structure:**
```
frontend/
├── index.html
├── style.css
├── app.js                 # Entry point only (~100 lines)
├── config.js              # Configuration
├── modules/
│   ├── api/
│   │   ├── client.js      # HTTP client
│   │   ├── parts.js       # Part endpoints
│   │   ├── stock.js       # Stock endpoints
│   │   └── auth.js        # Auth endpoints
│   ├── core/
│   │   ├── state.js       # State management
│   │   ├── router.js      # Routing
│   │   └── events.js      # Event bus
│   ├── features/
│   │   ├── wall/
│   │   │   ├── wall.js
│   │   │   ├── zoneConfig.js
│   │   │   └── shelfConfig.js
│   │   ├── catalog/
│   │   │   ├── catalog.js
│   │   │   ├── partManager.js
│   │   │   └── categoryManager.js
│   │   ├── profit/
│   │   │   └── profitEngine.js
│   │   └── scanner/
│   │       └── scanner.js
│   └── ui/
│       ├── modals/
│       │   ├── binModal.js
│       │   ├── handshake.js
│       │   └── batchEditor.js
│       ├── notifications.js
│       └── toast.js
└── utils/
    ├── dom.js
    ├── validation.js
    └── formatting.js
```

---

### ARCH-002: Global State Without Structure (CRITICAL)

**Location:** `/frontend/app.js:30-46`, `/frontend/profit.js:5-25`

**Description:**
Multiple global state objects without clear ownership or update patterns.

**Current State Objects:**
```javascript
// app.js:30-46
const state = {
    currentView: 'wall',
    selectedPart: null,
    catalog: { results: [], next: null, count: 0, loading: false },
    locations: new Map(),
    parts: new Map(),
    zones: [],
    isConnected: false
};

// profit.js:5-25
const profitState = {
    stockItems: [],
    transactions: [],
    components: [],
    dailyProfits: [],
    totalSales: 0,
    totalCogs: 0,
    totalProfit: 0,
    inventoryValue: 0,
    chart: null
};
```

**Issues:**
1. No clear boundary between UI state and domain state
2. Mutations happen anywhere in the code
3. No state change notifications
4. Cannot debug state changes
5. Cannot persist/restore state consistently

**Recommended Pattern:**
```javascript
// Implement minimal state management
const createStore = (initialState, reducers) => {
    let state = initialState;
    const listeners = new Set();

    return {
        getState: () => state,

        dispatch: (action) => {
            const reducer = reducers[action.type];
            if (reducer) {
                const prevState = state;
                state = reducer(state, action.payload);
                console.log(`[Store] ${action.type}`, { prev: prevState, next: state });
                listeners.forEach(l => l(state));
            }
        },

        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    };
};

// Usage
const store = createStore(
    { parts: new Map(), zones: [] },
    {
        SET_PARTS: (state, parts) => ({ ...state, parts }),
        ADD_ZONE: (state, zone) => ({ ...state, zones: [...state.zones, zone] })
    }
);

store.dispatch({ type: 'ADD_ZONE', payload: { name: 'C', columns: 4 } });
```

---

### ARCH-003: Tight Coupling Between Modules (HIGH)

**Description:**
Modules directly reference and call each other, creating implicit dependencies.

**Examples:**
```javascript
// handshake directly calls wall
wall.loadLiveData();  // app.js:2299

// catalog directly calls partManager
partManager.showEdit(part);  // app.js:2783

// batchEditor directly calls handshake
await handshake.moveStock(...);  // app.js:3215

// auth directly calls profitEngine
profitEngine.init();  // app.js:4301

// alerts directly calls catalog
catalog.scrollToPart(${item.pk});  // app.js:3795
```

**Dependency Matrix:**
```
              api  router  wall  catalog  scanner  handshake  auth
api            -     -      -      -        -         -        -
router         -     -      ✓      ✓        -         -        -
wall           ✓     -      -      -        -         -        -
catalog        ✓     -      -      -        -         ✓        -
scanner        ✓     ✓      -      ✓        -         ✓        -
handshake      ✓     -      ✓      -        -         -        -
auth           ✓     -      ✓      ✓        -         -        -
```

**Recommended Pattern:**
Use event-based communication:
```javascript
// Event bus
const events = {
    listeners: new Map(),

    on(event, handler) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(handler);
    },

    emit(event, data) {
        const handlers = this.listeners.get(event);
        if (handlers) {
            handlers.forEach(h => h(data));
        }
    }
};

// In handshake (emitter)
events.emit('stock:received', { partId, quantity, location });

// In wall (listener)
events.on('stock:received', () => wall.loadLiveData());

// In catalog (listener)
events.on('stock:received', () => catalog.reload());
```

---

### ARCH-004: Mixed Concerns in Components (HIGH)

**Description:**
Components mix UI logic, business logic, and data fetching.

**Example - handshake module (712 lines):**
```javascript
const handshake = {
    // UI concerns
    show() { ... },
    hide() { ... },
    renderStockInfo() { ... },

    // Business logic
    calculateFifoOrder() { ... },
    validateCapacity() { ... },

    // Data fetching
    async loadStockForPart() { ... },
    async updateBinProductInfo() { ... },

    // API calls
    async submitReceive() { ... },
    async submitPick() { ... },
    async moveStock() { ... },

    // Event handling
    onShelfChange() { ... },
};
```

**Recommended Separation:**
```javascript
// Data layer
const stockService = {
    async getStockForPart(partId) { ... },
    async receiveStock(data) { ... },
    async pickStock(data) { ... }
};

// Business logic
const fifoCalculator = {
    calculatePickOrder(stockItems) { ... },
    validateCapacity(shelf, part, qty) { ... }
};

// UI component
const handshakeModal = {
    elements: {},
    init() { ... },
    show(part) { ... },
    hide() { ... },
    render(data) { ... }
};

// Controller (orchestrates)
const handshakeController = {
    async handleReceive(formData) {
        const validated = fifoCalculator.validateCapacity(...);
        if (!validated) return;

        await stockService.receiveStock(formData);
        handshakeModal.hide();
        events.emit('stock:received');
    }
};
```

---

### ARCH-005: No Layered Architecture (HIGH)

**Description:**
The application lacks clear architectural layers (presentation, business, data).

**Current (Flat):**
```
┌────────────────────────────────────────────┐
│              Everything Mixed               │
│  UI + Business Logic + Data + API calls    │
└────────────────────────────────────────────┘
```

**Recommended (Layered):**
```
┌────────────────────────────────────────────┐
│           Presentation Layer               │
│  Components, Modals, Views, Templates      │
├────────────────────────────────────────────┤
│           Application Layer                │
│  Controllers, Use Cases, Workflows         │
├────────────────────────────────────────────┤
│           Domain Layer                     │
│  Business Rules, Entities, Value Objects   │
├────────────────────────────────────────────┤
│           Infrastructure Layer             │
│  API Client, Storage, External Services    │
└────────────────────────────────────────────┘
```

---

### ARCH-006: Missing Abstraction Layer for InvenTree (MEDIUM)

**Location:** `/frontend/app.js` - api object

**Description:**
Direct coupling to InvenTree API structure throughout the application.

**Current Pattern:**
```javascript
// InvenTree-specific endpoints hardcoded
const api = {
    getParts: (params) => request(`/part/?${new URLSearchParams(params)}`),
    getStockForPart: (partId) => request(`/stock/?part=${partId}`),
    // Direct InvenTree response structure assumed
};

// InvenTree response format used directly
const parts = data.results || [];  // DRF pagination format
```

**Impact:**
- Cannot easily switch inventory backend
- InvenTree API changes break multiple places
- Business logic tied to API structure

**Recommended Pattern:**
```javascript
// Repository pattern
const partRepository = {
    async findAll(filters) {
        const response = await inventreeApi.getParts(filters);
        return this.mapToPartEntities(response.results);
    },

    async findById(id) {
        const response = await inventreeApi.getPart(id);
        return this.mapToPartEntity(response);
    },

    // Maps API response to domain entity
    mapToPartEntity(apiPart) {
        return {
            id: apiPart.pk,
            name: apiPart.name,
            sku: apiPart.IPN,
            stock: apiPart.in_stock,
            minStock: apiPart.minimum_stock,
            // Normalize API structure to domain structure
        };
    }
};
```

---

### ARCH-007: No Error Boundary Pattern (MEDIUM)

**Description:**
Errors in one module can crash the entire application.

**Current State:**
```javascript
// Error in one module propagates
async function init() {
    // If wall.init() throws, everything stops
    wall.init();
    binModal.init();
    handshake.init();
    // ...
}
```

**Recommended Pattern:**
```javascript
const safeInit = async (moduleName, initFn) => {
    try {
        await initFn();
        console.log(`${moduleName} initialized`);
    } catch (error) {
        console.error(`${moduleName} failed to initialize:`, error);
        // Module-specific fallback or degraded mode
        notifications.show(`${moduleName} failed to load. Some features may be unavailable.`, 'warning');
    }
};

async function init() {
    await safeInit('Wall', () => wall.init());
    await safeInit('Catalog', () => catalog.init());
    await safeInit('Scanner', () => scanner.init());
    // Application continues even if some modules fail
}
```

---

### ARCH-008: No Feature Flag System (MEDIUM)

**Description:**
No mechanism for enabling/disabling features without code changes.

**Recommended Pattern:**
```javascript
const features = {
    flags: {
        NEW_PROFIT_CHART: false,
        FIFO_AUTOMATION: true,
        MULTI_TENANT: true,
    },

    isEnabled(flag) {
        return this.flags[flag] ?? false;
    },

    // Load from config or environment
    async init() {
        const remote = await api.getFeatureFlags();
        Object.assign(this.flags, remote);
    }
};

// Usage
if (features.isEnabled('NEW_PROFIT_CHART')) {
    profitEngine.renderNewChart();
} else {
    profitEngine.renderLegacyChart();
}
```

---

## Scalability Assessment

### Current Limitations

| Factor | Limit | Issue |
|--------|-------|-------|
| Parts | ~2,000 | API fetches all at once |
| Zones | ~10 | DOM becomes large |
| Stock Items | ~5,000 | Memory issues |
| Concurrent Users | 1 | No multi-tab sync |
| Transactions | ~1,000 | localStorage limit |

### Recommendations for Scale

1. **Virtual Scrolling** - Only render visible items
2. **Pagination** - Server-side filtering/sorting
3. **Caching Layer** - Reduce API calls
4. **WebSocket** - Real-time updates without polling
5. **IndexedDB** - For large local storage needs
6. **Web Workers** - Offload heavy calculations

---

## Testability Assessment

### Current State: Poor Testability

**Issues:**

1. **Global State**
   ```javascript
   // Cannot reset between tests
   const state = { ... };  // Global, mutable
   ```

2. **No Dependency Injection**
   ```javascript
   // Cannot mock dependencies
   const handshake = {
       async submit() {
           await api.createStock(...);  // Hardcoded dependency
           wall.loadLiveData();          // Hardcoded dependency
       }
   };
   ```

3. **DOM Coupling**
   ```javascript
   // Cannot test without DOM
   init() {
       dom.catalogSearch.addEventListener('input', ...);
   }
   ```

### Recommended Testable Architecture

```javascript
// Dependency injection
const createHandshakeModule = (deps) => {
    const { api, wall, toast } = deps;

    return {
        async submit(data) {
            await api.createStock(data);
            wall.loadLiveData();
            toast.show('Success');
        }
    };
};

// Test with mocks
const mockApi = { createStock: jest.fn() };
const mockWall = { loadLiveData: jest.fn() };
const mockToast = { show: jest.fn() };

const handshake = createHandshakeModule({
    api: mockApi,
    wall: mockWall,
    toast: mockToast
});

test('submit creates stock', async () => {
    await handshake.submit({ partId: 1, qty: 10 });
    expect(mockApi.createStock).toHaveBeenCalled();
});
```

---

## Recommended Architecture Evolution

### Phase 1: Extract Core (2 weeks)

```javascript
// Create core modules
// /modules/core/state.js
export const createStore = (initial) => { ... };

// /modules/core/events.js
export const createEventBus = () => { ... };

// /modules/core/api.js
export const createApiClient = (config) => { ... };
```

### Phase 2: Modularize Features (4 weeks)

```javascript
// Extract wall feature
// /modules/features/wall/index.js
export const createWallModule = (deps) => {
    const { api, events, store } = deps;
    // ...
};
```

### Phase 3: Add Testing (2 weeks)

```javascript
// Add test framework
npm install --save-dev vitest

// Write tests for core modules
// /tests/core/state.test.js
import { createStore } from '../modules/core/state';

test('store updates state', () => { ... });
```

### Phase 4: TypeScript Migration (4 weeks)

```typescript
// Add type safety
interface Part {
    id: number;
    name: string;
    sku: string;
    stock: number;
}

interface State {
    parts: Map<number, Part>;
    zones: Zone[];
    currentView: View;
}
```

---

## Architecture Decision Records (Recommended)

### ADR-001: Module Structure

**Status:** Proposed

**Context:** Current 4,358-line monolith is unmaintainable.

**Decision:** Split into feature-based module structure.

**Consequences:**
- Need ES modules or bundler
- Breaking change for deployment
- Enables testing and code splitting

---

### ADR-002: State Management

**Status:** Proposed

**Context:** Global mutable state causes bugs and testing issues.

**Decision:** Implement minimal Flux-like store.

**Consequences:**
- Learning curve
- Boilerplate increase
- Predictable state changes

---

## Summary Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Files | 4 JS | 20+ |
| Largest File | 4,358 lines | <500 |
| Cyclomatic Complexity | 25+ | <10 |
| Test Coverage | 0% | 60% |
| Module Coupling | High | Low |
| Type Coverage | 0% | 80% |

---

**Report Generated:** 2026-01-11
**Architecture Pattern:** Monolithic SPA (needs evolution)
**Recommended Evolution:** Modular ES6 with Event-Driven Communication
