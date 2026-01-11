# Performance Analysis Report

**Project:** Omiximo Inventory OS
**Date:** 2026-01-11
**Reviewer:** Performance Engineer Agent
**Scope:** Frontend JavaScript Performance, DOM Operations, Network Efficiency, Memory Management
**Methodology:** Static code analysis, pattern identification, complexity analysis

---

## Executive Summary

The Omiximo Inventory OS frontend demonstrates several performance anti-patterns that could cause degraded user experience, especially as data volume grows. The "no framework" approach, while reducing initial bundle size, has led to manual DOM manipulation patterns that are less optimized than modern virtual DOM implementations.

**Overall Performance Rating: 5/10**

### Key Performance Metrics (Estimated)

| Metric | Current (Est.) | Target | Status |
|--------|----------------|--------|--------|
| Initial JS Payload | ~200KB | <100KB | Needs Work |
| Time to Interactive | ~2-3s | <1.5s | Acceptable |
| Largest Contentful Paint | ~2s | <1.5s | Acceptable |
| DOM Node Count (Wall view) | ~500-1000 | <500 | At Risk |
| Memory Usage (after 1hr) | Unknown | <100MB | Needs Monitoring |
| API Requests (initial) | 5-8 | <4 | Needs Work |

---

## Critical Performance Issues

### PERF-001: N+1 Query Pattern in Wall Data Loading (CRITICAL)

**Location:** `/frontend/app.js:1454-1528` (wall.loadLiveData)

**Impact:** Linear API call growth with zone/cell count

**Description:**
The wall loading function makes individual API calls for each cell in the grid, creating an N+1 query pattern that doesn't scale.

**Problematic Code:**
```javascript
// app.js:1454-1528 - loadLiveData()
async loadLiveData() {
    const zones = zoneConfig.getAllZones();

    for (const zone of zones) {
        for (let col = 1; col <= zone.columns; col++) {
            for (let lvl = 1; lvl <= zone.levels; lvl++) {
                // PROBLEM: Individual API call per cell!
                const stock = await api.getStockAtLocation(loc.pk);
                // ...
            }
        }
    }
}
```

**Performance Impact:**
- 2 zones x 4 columns x 7 levels = 56 API calls
- Each call: ~50-200ms network latency
- Total: 2.8 - 11.2 seconds for full load
- Blocks UI during loading

**Recommendation:**
Batch API requests:
```javascript
async loadLiveData() {
    const zones = zoneConfig.getAllZones();

    // Collect all location IDs
    const locationIds = [];
    for (const zone of zones) {
        for (let col = 1; col <= zone.columns; col++) {
            for (let lvl = 1; lvl <= zone.levels; lvl++) {
                const cellId = `${zone.name}-${col}-${lvl}`;
                // ... get location ID
                if (loc?.pk) locationIds.push(loc.pk);
            }
        }
    }

    // Single batch request
    const allStock = await api.getStockBatch(locationIds);
    // Or: GET /api/stock/?location__in=1,2,3,4...

    // Distribute to cells
    this.distributeStockToGrid(allStock);
}
```

---

### PERF-002: Repeated DOM Queries Without Caching (CRITICAL)

**Location:** Throughout codebase

**Impact:** Unnecessary DOM traversal on every operation

**Description:**
The application repeatedly queries the DOM for elements that don't change, causing unnecessary reflow calculations.

**Problematic Patterns:**
```javascript
// app.js - binInfoModal.show() queries every time
show(cellId) {
    // These elements never change, but queried on every show()
    document.getElementById('binInfoTitle').textContent = ...;
    document.getElementById('binInfoShelfId').textContent = ...;
    document.getElementById('binInfoZone').textContent = ...;
    document.getElementById('binProductSection').style.display = ...;
    // ... 20+ more getElementById calls
}

// app.js:2776-2778 - Catalog queries on every card
document.querySelectorAll('.part-card').forEach(card => {
    // Attaches listeners after every render
});

// app.js:2989-2999 - batchDetail.show() queries every time
document.getElementById('batchDetailPartName').textContent = ...;
document.getElementById('batchDetailSKU').textContent = ...;
// ... 15+ more getElementById calls
```

**Recommendation:**
Cache DOM references at initialization:
```javascript
const binInfoModal = {
    // Cache DOM references once
    elements: null,

    init() {
        this.elements = {
            modal: document.getElementById('binInfoModal'),
            title: document.getElementById('binInfoTitle'),
            shelfId: document.getElementById('binInfoShelfId'),
            zone: document.getElementById('binInfoZone'),
            productSection: document.getElementById('binProductSection'),
            // ... all elements
        };
    },

    show(cellId) {
        // Use cached references
        this.elements.title.textContent = cellId;
        this.elements.shelfId.textContent = shelfId;
        // Much faster!
    }
};
```

---

### PERF-003: Inefficient innerHTML Rebuilding (HIGH)

**Location:** Multiple render functions

**Impact:** Full DOM destruction and recreation on updates

**Description:**
The application rebuilds entire DOM trees using innerHTML instead of updating only changed elements.

**Problematic Code:**
```javascript
// app.js:2753 - Destroys and rebuilds entire catalog grid
dom.catalogGrid.innerHTML = parts.map(p => this.createCard(p)).join('');

// app.js:2841-2863 - Rebuilds batch list
batchList.innerHTML = stocks.map((stock, idx) => {
    // ... create batch HTML
}).join('');

// app.js:3687-3698 - Rebuilds notification stack
container.innerHTML = visibleNotifs.map(notif => `...`).join('');

// profit.js:420-468 - Rebuilds component list
container.innerHTML = profitState.components.map((c, idx) => `...`).join('');

// wall.render() - Rebuilds entire wall grid
container.innerHTML = zones.map(zone => {
    // Generates ~500+ DOM nodes
}).join('');
```

**Performance Impact:**
- Destroys existing DOM nodes (triggers garbage collection)
- Parses HTML strings (slower than DOM methods)
- Loses event listeners (must be re-attached)
- Causes layout thrashing (reflow/repaint)

**Recommendation:**
Implement differential updates:
```javascript
// Option 1: Update only changed cells
updateWallCell(cellId, newData) {
    const cell = document.querySelector(`[data-cell-id="${cellId}"]`);
    if (!cell) return;

    const qtyElement = cell.querySelector('.cell-content');
    if (qtyElement.textContent !== String(newData.qty)) {
        qtyElement.textContent = newData.qty;
        // Only this cell repaints
    }
}

// Option 2: Use DocumentFragment for batch inserts
renderCatalog(parts) {
    const fragment = document.createDocumentFragment();
    parts.forEach(part => {
        fragment.appendChild(this.createCardElement(part));
    });
    dom.catalogGrid.replaceChildren(fragment);
}
```

---

## High Severity Performance Issues

### PERF-004: Unoptimized Event Listeners (HIGH)

**Location:** `/frontend/app.js:2772-2823`

**Issue:** Event listeners attached to individual elements instead of delegated.

**Problematic Code:**
```javascript
// app.js:2772-2823 - attachCardListeners()
attachCardListeners() {
    document.querySelectorAll('.part-card').forEach(card => {
        const editBtn = card.querySelector('.part-card-action.edit');
        if (editBtn) {
            editBtn.addEventListener('click', (e) => { ... });
        }

        const deleteBtn = card.querySelector('.part-card-action.delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => { ... });
        }

        const mainSection = card.querySelector('.part-card-main');
        if (mainSection) {
            mainSection.addEventListener('click', async (e) => { ... });
        }

        const addBatchBtn = card.querySelector('.btn-add-batch');
        if (addBatchBtn) {
            addBatchBtn.addEventListener('click', (e) => { ... });
        }
    });
}
```

**Impact:**
- 24 parts x 4 listeners = 96 event listeners per page
- Memory usage grows with part count
- Must be re-run after every render

**Recommendation:**
Use event delegation:
```javascript
initCatalogListeners() {
    // Single listener for entire grid
    dom.catalogGrid.addEventListener('click', (e) => {
        const card = e.target.closest('.part-card');
        if (!card) return;

        const partId = parseInt(card.dataset.partId);

        if (e.target.closest('.part-card-action.edit')) {
            partManager.showEdit(state.parts.get(partId));
        } else if (e.target.closest('.part-card-action.delete')) {
            partManager.showDelete(state.parts.get(partId));
        } else if (e.target.closest('.btn-add-batch')) {
            state.selectedPart = state.parts.get(partId);
            handshake.show(state.parts.get(partId));
        } else if (e.target.closest('.part-card-main')) {
            this.toggleCardExpansion(card, partId);
        }
    });
}
```

---

### PERF-005: Synchronous LocalStorage Operations (HIGH)

**Location:** Throughout codebase

**Issue:** Synchronous localStorage calls block the main thread.

**Problematic Code:**
```javascript
// app.js:632-643 - zoneConfig.load()
load() {
    const saved = localStorage.getItem('omiximo_zones');  // Blocking
    // ...
}

// app.js:658-660 - zoneConfig.save()
save() {
    localStorage.setItem('omiximo_zones', JSON.stringify(zones));  // Blocking
}

// Multiple other localStorage calls:
// - localStorage.getItem('inventree_token')
// - localStorage.setItem('omiximo_view', view)
// - localStorage.getItem('jit_config')
// - localStorage.setItem('omiximo_transactions', ...)
```

**Impact:**
- Blocks UI thread during read/write
- Larger data = longer blocking time
- Can cause jank during user interactions

**Recommendation:**
```javascript
// Debounce saves
const debouncedSave = debounce((key, data) => {
    requestIdleCallback(() => {
        localStorage.setItem(key, JSON.stringify(data));
    });
}, 500);

// Or use async wrapper with Web Workers for large data
const asyncStorage = {
    get: async (key) => {
        return new Promise(resolve => {
            requestIdleCallback(() => {
                resolve(JSON.parse(localStorage.getItem(key) || 'null'));
            });
        });
    }
};
```

---

### PERF-006: No Request Deduplication (HIGH)

**Location:** API client and data loading

**Issue:** Same data requested multiple times simultaneously.

**Problematic Code:**
```javascript
// Multiple places call loadParts() or similar
// app.js:4297 - alerts.checkLowStock() calls getParts()
await alerts.checkLowStock();

// app.js:4301 - profitEngine may also need parts
profitEngine.init();

// Periodic refresh also reloads everything
setInterval(async () => {
    await checkConnection();
    await wall.loadLiveData();
    await alerts.checkLowStock();  // May duplicate requests
}, CONFIG.REFRESH_INTERVAL);
```

**Recommendation:**
Implement request deduplication:
```javascript
const requestCache = {
    pending: new Map(),

    async dedupe(key, fetcher) {
        if (this.pending.has(key)) {
            return this.pending.get(key);
        }

        const promise = fetcher();
        this.pending.set(key, promise);

        try {
            return await promise;
        } finally {
            this.pending.delete(key);
        }
    }
};

// Usage
const getParts = () => requestCache.dedupe('parts', () =>
    fetch('/api/part/').then(r => r.json())
);
```

---

### PERF-007: Unthrottled Scroll/Resize Handlers (HIGH)

**Location:** Potential issue (not explicitly found but pattern suggests)

**Issue:** Event handlers that may fire rapidly without throttling.

**Recommendation:**
```javascript
const throttle = (fn, wait) => {
    let lastTime = 0;
    return (...args) => {
        const now = Date.now();
        if (now - lastTime >= wait) {
            lastTime = now;
            fn(...args);
        }
    };
};

window.addEventListener('resize', throttle(() => {
    // Handle resize
}, 100));
```

---

## Medium Severity Performance Issues

### PERF-008: Large CSS File (4,732 lines) (MEDIUM)

**Location:** `/frontend/style.css`

**Issue:** Single CSS file with all styles, no code splitting.

**Impact:**
- ~100KB+ CSS to parse on initial load
- Browser must process all selectors even if unused
- No caching benefit for unchanged sections

**Recommendation:**
- Split into critical (above-fold) and non-critical CSS
- Use CSS containment for isolated components
- Consider CSS-in-JS for component-scoped styles

---

### PERF-009: No Virtual Scrolling for Large Lists (MEDIUM)

**Location:** Catalog view, history view

**Issue:** All items rendered to DOM regardless of visibility.

**Problematic Pattern:**
```javascript
// app.js:2753 - All parts rendered at once
dom.catalogGrid.innerHTML = parts.map(p => this.createCard(p)).join('');
// If 1000 parts, 1000 DOM nodes created
```

**Recommendation:**
Implement virtual scrolling or pagination:
```javascript
const VirtualList = {
    visibleCount: 20,
    itemHeight: 120,
    scrollTop: 0,

    render(items) {
        const startIndex = Math.floor(this.scrollTop / this.itemHeight);
        const endIndex = startIndex + this.visibleCount;
        const visibleItems = items.slice(startIndex, endIndex);

        return visibleItems.map((item, i) => ({
            ...item,
            style: `transform: translateY(${(startIndex + i) * this.itemHeight}px)`
        }));
    }
};
```

---

### PERF-010: Chart.js Full Library Loaded (MEDIUM)

**Location:** `/frontend/index.html`

**Issue:** Full Chart.js library loaded even when not viewing profit page.

```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
```

**Impact:** ~200KB additional JavaScript parsed on initial load.

**Recommendation:**
Lazy load Chart.js:
```javascript
let chartModule = null;

async function loadChart() {
    if (!chartModule) {
        chartModule = await import('https://cdn.jsdelivr.net/npm/chart.js/+esm');
    }
    return chartModule;
}

// In profitEngine.init():
const Chart = await loadChart();
```

---

### PERF-011: No Caching Strategy for API Responses (MEDIUM)

**Location:** API client

**Issue:** Every navigation triggers fresh API calls, no caching.

**Recommendation:**
```javascript
const apiCache = {
    cache: new Map(),
    ttl: 30000, // 30 seconds

    async get(key, fetcher) {
        const cached = this.cache.get(key);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.data;
        }

        const data = await fetcher();
        this.cache.set(key, {
            data,
            expiresAt: Date.now() + this.ttl
        });
        return data;
    },

    invalidate(key) {
        this.cache.delete(key);
    }
};
```

---

### PERF-012: Polling Instead of WebSocket (MEDIUM)

**Location:** `/frontend/app.js:4307-4312`

**Issue:** 30-second polling interval for updates instead of push notifications.

```javascript
setInterval(async () => {
    await checkConnection();
    await wall.loadLiveData();
    await alerts.checkLowStock();
}, CONFIG.REFRESH_INTERVAL);
```

**Impact:**
- Wasted requests when no data changes
- 30-second delay in seeing updates
- Battery drain on mobile devices

**Recommendation:**
Implement WebSocket for real-time updates:
```javascript
const realtime = {
    ws: null,

    connect() {
        this.ws = new WebSocket('wss://api/ws/stock/');
        this.ws.onmessage = (e) => {
            const update = JSON.parse(e.data);
            wall.updateCell(update.location, update);
        };
    }
};
```

---

### PERF-013 to PERF-016: Additional Medium Issues

- **PERF-013:** No image lazy loading (if images are added)
- **PERF-014:** Animation performance (use transform instead of position)
- **PERF-015:** Font loading strategy (no font-display: swap)
- **PERF-016:** No service worker for offline caching

---

## Low Severity Performance Issues

### PERF-017: Console Logging in Production (LOW)

**Location:** Throughout codebase (80+ console.log statements)

**Impact:** Minor performance overhead, potential memory leak from logged objects.

---

### PERF-018: Date Formatting on Every Render (LOW)

**Location:** History view, batch detail

```javascript
// app.js:4019-4043 - formatDate called per item
formatDate(date) {
    const now = new Date();  // Created on every call
    // ... calculations
}
```

**Recommendation:** Cache "now" at render start.

---

### PERF-019 to PERF-022: Additional Low Issues

- **PERF-019:** String concatenation instead of template literals in some places
- **PERF-020:** Unused CSS selectors (estimated 20-30%)
- **PERF-021:** No preconnect/prefetch hints for CDN
- **PERF-022:** Missing async/defer on script tags

---

## Performance Optimization Recommendations

### Quick Wins (1-2 days each)

| # | Optimization | Impact | Effort |
|---|-------------|--------|--------|
| 1 | Cache DOM references | High | Low |
| 2 | Event delegation | High | Low |
| 3 | Add async/defer to scripts | Medium | Low |
| 4 | Remove console.logs | Low | Low |
| 5 | Add preconnect hints | Low | Low |

### Medium-term (1 week each)

| # | Optimization | Impact | Effort |
|---|-------------|--------|--------|
| 6 | Batch API requests | Critical | Medium |
| 7 | Implement request caching | High | Medium |
| 8 | Lazy load Chart.js | Medium | Low |
| 9 | Split CSS (critical path) | Medium | Medium |
| 10 | Request deduplication | High | Medium |

### Long-term (2+ weeks)

| # | Optimization | Impact | Effort |
|---|-------------|--------|--------|
| 11 | Virtual scrolling | High | High |
| 12 | WebSocket for updates | Medium | High |
| 13 | Service worker | Medium | High |
| 14 | Differential DOM updates | High | High |

---

## Benchmark Recommendations

### Metrics to Monitor

```javascript
// Add performance monitoring
const perf = {
    mark(name) {
        performance.mark(name);
    },

    measure(name, startMark, endMark) {
        performance.measure(name, startMark, endMark);
        const entry = performance.getEntriesByName(name)[0];
        console.log(`[Perf] ${name}: ${entry.duration.toFixed(2)}ms`);
    }
};

// Usage
perf.mark('wall-load-start');
await wall.loadLiveData();
perf.mark('wall-load-end');
perf.measure('Wall Load Time', 'wall-load-start', 'wall-load-end');
```

### Suggested Performance Budget

| Metric | Budget | Measurement |
|--------|--------|-------------|
| First Contentful Paint | <1.5s | Lighthouse |
| Time to Interactive | <3.0s | Lighthouse |
| Total Blocking Time | <300ms | Lighthouse |
| Cumulative Layout Shift | <0.1 | Lighthouse |
| JS Execution Time | <2s | DevTools |
| Memory (after 1hr) | <100MB | DevTools |

---

## Memory Leak Potential

### Areas of Concern

1. **Event listeners not cleaned up:**
   ```javascript
   // Listeners added on every render but never removed
   attachCardListeners() {
       document.querySelectorAll('.part-card').forEach(card => {
           card.addEventListener('click', ...);
       });
   }
   ```

2. **Intervals not cleared:**
   ```javascript
   // app.js:4141 - Clock interval
   setInterval(updateClock, 1000);  // Never cleared

   // app.js:4307 - Refresh interval
   setInterval(async () => { ... }, CONFIG.REFRESH_INTERVAL);  // Never cleared
   ```

3. **Closures holding references:**
   ```javascript
   // Modal close handlers may hold modal DOM reference
   modal.addEventListener('click', (e) => {
       if (e.target === modal) this.hide();
   });
   ```

### Recommendation

```javascript
// Track intervals for cleanup
const intervals = new Set();

const createInterval = (fn, ms) => {
    const id = setInterval(fn, ms);
    intervals.add(id);
    return id;
};

const cleanup = () => {
    intervals.forEach(id => clearInterval(id));
    intervals.clear();
};

// Call on logout or page unload
window.addEventListener('beforeunload', cleanup);
```

---

## Testing Recommendations

### Performance Testing Script

```javascript
// Add to benchmark_api.js or new file
const perfTest = async () => {
    console.log('Starting performance tests...');

    // Test wall load time
    const wallStart = performance.now();
    await wall.loadLiveData();
    console.log(`Wall load: ${performance.now() - wallStart}ms`);

    // Test catalog render time
    const catalogStart = performance.now();
    await catalog.reload();
    console.log(`Catalog render: ${performance.now() - catalogStart}ms`);

    // Memory snapshot
    if (performance.memory) {
        console.log('Memory:', {
            used: `${(performance.memory.usedJSHeapSize / 1048576).toFixed(2)}MB`,
            total: `${(performance.memory.totalJSHeapSize / 1048576).toFixed(2)}MB`
        });
    }

    // DOM node count
    console.log('DOM nodes:', document.getElementsByTagName('*').length);
};
```

---

**Report Generated:** 2026-01-11
**Next Review:** After implementing quick wins
