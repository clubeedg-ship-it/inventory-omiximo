/**
 * =============================================================================
 * OMIXIMO INVENTORY OS - Main Application
 * Router, Scanner Logic, Wall Renderer
 * =============================================================================
 */

// =============================================================================
// Configuration
// =============================================================================
const CONFIG = {
    // Check for runtime config (from env.js) or fallback to default
    API_BASE: (window.ENV && window.ENV.API_BASE) ? window.ENV.API_BASE : 'http://localhost:8000/api',
    API_TOKEN: null,
    REFRESH_INTERVAL: 30000,
    SCAN_TIMEOUT: 100,  // Reduced for faster scanner detection
    SCAN_AUDIO_ENABLED: true,  // User preference for beep
    ZONES: ['A', 'B'],
    COLUMNS: 4,
    LEVELS: 7,
    POWER_SUPPLY_COLUMN: 'B-4'
};

// =============================================================================
// State
// =============================================================================
const state = {
    currentView: 'wall',
    locations: new Map(),
    parts: new Map(),
    isConnected: false,
    scanBuffer: '',
    scanTimer: null,
    selectedPart: null
};

// =============================================================================
// DOM Elements
// =============================================================================
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {
    // Views
    views: $$('.view'),
    navItems: $$('.nav-item[data-view]'),
    viewTitle: $('viewTitle'),

    // Wall
    wallGrid: $('wallGrid'),

    // Header
    clock: $('clock'),
    scanStatus: $('scanStatus'),
    scanText: $('scanText'),

    // Modals
    binModal: $('binModal'),
    binModalClose: $('binModalClose'),
    binModalTitle: $('binModalTitle'),
    binModalSubtitle: $('binModalSubtitle'),
    binAContent: $('binAContent'),
    binBContent: $('binBContent'),

    handshakeModal: $('handshakeModal'),
    handshakeClose: $('handshakeClose'),
    handshakeAction: $('handshakeAction'),
    handshakePartName: $('handshakePartName'),
    handshakeSKU: $('handshakeSKU'),
    handshakeForm: $('handshakeForm'),
    inputQty: $('inputQty'),
    inputPrice: $('inputPrice'),
    inputBin: $('inputBin'),
    successFeedback: $('successFeedback'),

    // Toast
    toast: $('toast'),
    toastMessage: $('toastMessage'),

    // Catalog
    catalogSearch: $('catalogSearch'),
    catalogGrid: $('catalogGrid')
};

// =============================================================================
// Tenant-Aware Query Builder
// =============================================================================
function buildTenantQuery(baseParams = {}) {
    const tenantFilter = (typeof tenant !== 'undefined' && tenant.current) ? tenant.getFilter() : {};
    const merged = { ...baseParams, ...tenantFilter };
    const query = new URLSearchParams(merged).toString();
    return query ? `?${query}` : '';
}

// =============================================================================
// API Client
// =============================================================================
const api = {
    async request(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };

        if (CONFIG.API_TOKEN) {
            headers['Authorization'] = `Token ${CONFIG.API_TOKEN}`;
        }

        const response = await fetch(`${CONFIG.API_BASE}${endpoint}`, {
            ...options,
            headers: { ...headers, ...options.headers }
        });

        if (!response.ok) throw new Error(`API ${response.status}`);

        // Handle empty responses (e.g., DELETE returns 204 No Content)
        const text = await response.text();
        return text ? JSON.parse(text) : {};
    },

    async authenticate(user, pass) {
        try {
            const response = await fetch(`${CONFIG.API_BASE}/user/token/`, {
                headers: {
                    'Authorization': 'Basic ' + btoa(`${user}:${pass}`),
                    'Accept': 'application/json'
                }
            });
            if (response.ok) {
                const data = await response.json();
                CONFIG.API_TOKEN = data.token;
                return true;
            }
        } catch (e) {
            console.error('Auth failed:', e);
        }
        return false;
    },

    async getLocations() {
        const query = buildTenantQuery({ limit: 500 });
        const data = await this.request(`/stock/location/${query}`);
        return data.results || data;
    },

    async getParts() {
        const query = buildTenantQuery({ limit: 500 });
        const data = await this.request(`/part/${query}`);
        return data.results || data;
    },

    async getStockAtLocation(locId) {
        const data = await this.request(`/stock/?location=${locId}&limit=100`);
        return data.results || data;
    },

    async searchPart(query) {
        const data = await this.request(`/part/?search=${encodeURIComponent(query)}&limit=10`);
        return data.results || data;
    },

    async createStock(partId, locationId, qty, price, notes = '') {
        const body = {
            part: partId,
            location: locationId,
            quantity: qty,
            purchase_price: price
        };
        // Add notes if provided (for storing source URL)
        if (notes) {
            body.notes = notes;
        }
        return this.request('/stock/', {
            method: 'POST',
            body: JSON.stringify(body)
        });
    },

    /**
     * Get stock items for a part with allocation data
     * @param {number} partId - Part ID
     * @returns {Promise<Array>} Stock items with allocated quantities
     */
    async getStockWithAllocation(partId) {
        const data = await this.request(`/stock/?part=${partId}&include_variants=true`);
        return data.results || data;
    },

    /**
     * Calculate available stock (total - allocated)
     * @param {number} partId - Part ID
     * @returns {Promise<Object>} { total, allocated, available }
     */
    async getAvailableStock(partId) {
        const stock = await this.getStockWithAllocation(partId);
        const totals = stock.reduce((acc, s) => {
            acc.total += s.quantity || 0;
            acc.allocated += s.allocated || 0;
            return acc;
        }, { total: 0, allocated: 0 });

        return {
            ...totals,
            available: totals.total - totals.allocated
        };
    },

    /**
     * Get all stock items for a part (for FIFO picking)
     * @param {number} partId - Part ID
     * @returns {Promise<Array>} Stock items sorted by oldest first
     */
    async getStockForPart(partId) {
        const data = await this.request(`/stock/?part=${partId}&in_stock=true&ordering=updated`);
        return data.results || data;
    },

    /**
     * Consume stock from a specific stock item (reduce quantity)
     * @param {number} stockItemId - Stock item ID
     * @param {number} qty - Quantity to consume
     * @returns {Promise<Object>} Updated stock item
     */
    async consumeStock(stockItemId, qty) {
        // InvenTree uses a "take" API or direct quantity update
        // Using the stock adjustment endpoint
        return this.request(`/stock/${stockItemId}/`, {
            method: 'PATCH',
            body: JSON.stringify({
                quantity: qty
            })
        });
    },

    /**
     * Remove stock items (delete or set to 0)
     * @param {number} stockItemId - Stock item ID
     * @param {number} qty - Quantity to remove
     */
    async removeStock(stockItemId, qty) {
        // Use stock move/remove endpoint
        return this.request('/stock/remove/', {
            method: 'POST',
            body: JSON.stringify({
                items: [{ pk: stockItemId, quantity: qty }],
                notes: 'Picked via Omiximo OS'
            })
        });
    },

    // =========================================================================
    // Part CRUD Operations
    // =========================================================================

    /**
     * Get part categories
     * @returns {Promise<Array>} List of categories
     */
    async getCategories() {
        const data = await this.request('/part/category/?limit=100');
        return data.results || data;
    },

    /**
     * Get single part details
     * @param {number} partId - Part ID
     * @returns {Promise<Object>} Part details
     */
    async getPart(partId) {
        return this.request(`/part/${partId}/`);
    },

    /**
     * Create a new part
     * @param {Object} data - Part data
     * @returns {Promise<Object>} Created part
     */
    async createPart(data) {
        return this.request('/part/', {
            method: 'POST',
            body: JSON.stringify({
                name: data.name,
                IPN: data.ipn || '',
                description: data.description || '',
                category: data.category || null,
                minimum_stock: data.minimum_stock || 0,
                component: true,  // This is a component/stock item
                purchaseable: true,
                salable: false,
                active: true
            })
        });
    },

    /**
     * Update an existing part
     * @param {number} partId - Part ID
     * @param {Object} data - Updated part data
     * @returns {Promise<Object>} Updated part
     */
    async updatePart(partId, data) {
        const payload = {};
        if (data.name !== undefined) payload.name = data.name;
        if (data.ipn !== undefined) payload.IPN = data.ipn;
        if (data.description !== undefined) payload.description = data.description;
        if (data.category !== undefined) payload.category = data.category;
        if (data.minimum_stock !== undefined) payload.minimum_stock = data.minimum_stock;

        return this.request(`/part/${partId}/`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
        });
    },

    /**
     * Delete a part
     * @param {number} partId - Part ID
     * @returns {Promise<void>}
     */
    async deletePart(partId) {
        return this.request(`/part/${partId}/`, {
            method: 'DELETE'
        });
    },

    /**
     * Create a new part category
     * @param {Object} data - Category data
     * @returns {Promise<Object>} Created category
     */
    async createCategory(data) {
        return this.request('/part/category/', {
            method: 'POST',
            body: JSON.stringify({
                name: data.name,
                description: data.description || '',
                parent: data.parent || null
            })
        });
    }
};

// =============================================================================
// Router with Warp Transitions
// =============================================================================
const router = {
    init() {
        dom.navItems.forEach(item => {
            item.addEventListener('click', () => {
                const view = item.dataset.view;
                this.navigate(view);
            });
        });

        // Instant restore on load
        this.restoreSavedView(true);
    },

    navigate(view) {
        // Don't navigate to current view
        if (state.currentView === view) return;

        const currentViewEl = document.querySelector('.view.active');
        const nextViewEl = document.getElementById(`view-${view}`);

        if (currentViewEl && nextViewEl) {
            // Step 1: Warp out current view
            currentViewEl.classList.add('warping-out');

            // Step 2: After warp-out animation, switch views
            setTimeout(() => {
                // Remove active from all views
                dom.views.forEach(v => {
                    v.classList.remove('active', 'warping-out');
                });

                // Activate new view (triggers warp-in animation)
                nextViewEl.classList.add('active');

                // Update state and persist
                state.currentView = view;
                localStorage.setItem('omiximo_view', view);

                // Update nav
                dom.navItems.forEach(item => {
                    item.classList.toggle('active', item.dataset.view === view);
                });

                // Update title
                const titles = {
                    wall: 'The Wall',
                    catalog: 'Parts Catalog',
                    profit: 'Profitability'
                };
                dom.viewTitle.textContent = titles[view] || view;

                // Refresh catalog when navigating to it
                if (view === 'catalog') {
                    catalog.render();
                }

                // Render profitability engine when navigating to it
                if (view === 'profit' && typeof profitEngine !== 'undefined') {
                    profitEngine.render();
                }
            }, 200); // Match warp-out animation duration
        }
    },

    /**
     * Restore saved view from localStorage
     * @param {boolean} instant - If true, switch immediately without animation
     */
    restoreSavedView(instant = false) {
        const savedView = localStorage.getItem('omiximo_view');
        // Default to 'wall' if nothing saved, but don't force it if we are already there
        const targetView = savedView || 'wall';

        console.log('🔍 Checking saved view:', targetView, 'current:', state.currentView, 'instant:', instant);

        if (targetView !== state.currentView) {
            console.log('🔄 Restoring view to:', targetView);

            if (instant) {
                // Immediate switch (no animation)
                dom.views.forEach(v => {
                    v.classList.remove('active', 'warping-out', 'hidden');
                    if (v.id === `view-${targetView}`) {
                        v.classList.add('active');
                    } else {
                        v.classList.add('hidden');
                    }
                });

                // Update nav state
                dom.navItems.forEach(item => {
                    item.classList.toggle('active', item.dataset.view === targetView);
                });

                // Update title
                const titles = { wall: 'The Wall', catalog: 'Parts Catalog', profit: 'Profitability' };
                dom.viewTitle.textContent = titles[targetView] || targetView;

                state.currentView = targetView;

            } else {
                // Animated switch
                setTimeout(() => {
                    this.navigate(targetView);
                }, 300);
            }
        }
    }
};

// =============================================================================
// Settings Panel & Theme
// =============================================================================
const settings = {
    panel: null,
    gear: null,
    themeSwitch: null,

    init() {
        this.panel = document.getElementById('settingsPanel');
        this.gear = document.getElementById('settingsGear');
        this.themeSwitch = document.getElementById('themeSwitch');

        if (!this.gear || !this.panel) {
            console.warn('Settings panel elements not found');
            return;
        }

        // Toggle panel on gear click
        this.gear.addEventListener('click', (e) => {
            e.stopPropagation();
            this.togglePanel();
        });

        // Close panel when clicking outside
        document.addEventListener('click', (e) => {
            if (this.panel.classList.contains('active') &&
                !this.panel.contains(e.target) &&
                !this.gear.contains(e.target)) {
                this.closePanel();
            }
        });

        // Theme switch handling
        if (this.themeSwitch) {
            this.themeSwitch.addEventListener('click', () => {
                const current = document.documentElement.dataset.theme || 'dark';
                const newTheme = current === 'dark' ? 'light' : 'dark';
                this.setTheme(newTheme);
            });
        }

        // Initialize theme
        const savedTheme = localStorage.getItem('theme') || 'dark';
        this.setTheme(savedTheme);
    },

    togglePanel() {
        const isActive = this.panel.classList.toggle('active');
        this.gear.classList.toggle('active', isActive);

        if (isActive) {
            this.loadUserInfo();
        }
    },

    closePanel() {
        this.panel.classList.remove('active');
        this.gear.classList.remove('active');
    },

    setTheme(mode) {
        document.documentElement.dataset.theme = mode;
        document.body.dataset.theme = mode;
        localStorage.setItem('theme', mode);

        // Update theme switch buttons
        const options = document.querySelectorAll('.theme-option');
        options.forEach(opt => {
            opt.classList.toggle('active', opt.dataset.theme === mode);
        });
    },

    async loadUserInfo() {
        try {
            const resp = await api.request('/user/me/');
            if (resp) {
                const userName = document.getElementById('userName');
                const userRole = document.getElementById('userRole');
                const userAvatar = document.getElementById('userAvatar');

                if (userName) userName.textContent = resp.username || 'User';
                if (userRole) {
                    if (resp.is_superuser) {
                        userRole.textContent = '⭐ Super Admin';
                    } else if (resp.is_staff) {
                        userRole.textContent = '👤 Staff';
                    } else {
                        userRole.textContent = '👤 User';
                    }
                }
                if (userAvatar) {
                    userAvatar.textContent = resp.is_superuser ? '👑' : '👤';
                }
            }
        } catch (e) {
            console.warn('Failed to load user info:', e);
        }
    }
};

// Legacy alias for backwards compatibility
const theme = {
    init() {
        settings.init();
    },
    set(mode) {
        settings.setTheme(mode);
    }
};

// =============================================================================
// Clock
// =============================================================================
function updateClock() {
    const now = new Date();
    dom.clock.textContent = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

// =============================================================================
// Wall Grid Renderer
// =============================================================================
const wall = {
    init() {
        this.render();
    },

    render() {
        dom.wallGrid.innerHTML = '';

        // Rows from Level 7 (top) to Level 1 (bottom)
        for (let level = CONFIG.LEVELS; level >= 1; level--) {
            const row = document.createElement('div');
            row.className = 'grid-row';

            // Row label
            const label = document.createElement('div');
            label.className = 'row-label';
            label.textContent = `L${level}`;
            row.appendChild(label);

            // Zone A cells
            for (let col = 1; col <= CONFIG.COLUMNS; col++) {
                const cellId = `A-${col}-${level}`;
                row.appendChild(this.createCell(cellId, false));
            }

            // Zone divider
            const divider = document.createElement('div');
            divider.className = 'zone-divider';
            row.appendChild(divider);

            // Zone B cells
            for (let col = 1; col <= CONFIG.COLUMNS; col++) {
                const cellId = `B-${col}-${level}`;
                const isPowerSupply = `B-${col}` === CONFIG.POWER_SUPPLY_COLUMN;
                row.appendChild(this.createCell(cellId, isPowerSupply));
            }

            dom.wallGrid.appendChild(row);
        }
    },

    createCell(cellId, isPowerSupply) {
        const cell = document.createElement('div');
        cell.className = 'cell empty';
        cell.dataset.cellId = cellId;

        if (isPowerSupply) {
            cell.classList.add('solid');
            // Single bin for power supplies
            const bin = document.createElement('div');
            bin.className = 'bin-half';
            bin.innerHTML = '<span class="qty">-</span>';
            cell.appendChild(bin);
        } else {
            // Split bins for standard cells
            const binA = document.createElement('div');
            binA.className = 'bin-half bin-a';
            binA.innerHTML = '<span class="label">A</span><span class="qty">-</span>';

            const binB = document.createElement('div');
            binB.className = 'bin-half bin-b';
            binB.innerHTML = '<span class="label">B</span><span class="qty">-</span>';

            cell.appendChild(binA);
            cell.appendChild(binB);
        }

        cell.addEventListener('click', () => this.showCellDetails(cellId, isPowerSupply));

        return cell;
    },

    async showCellDetails(cellId, isPowerSupply) {
        const [zone, col, level] = cellId.split('-');

        // Track current cell for print button
        binModal.currentCellId = cellId;

        dom.binModalTitle.textContent = cellId;
        dom.binModalSubtitle.textContent = `Zone ${zone} · Column ${col} · Level ${level}`;

        dom.binAContent.innerHTML = '<div class="empty-bin">Loading...</div>';
        dom.binBContent.innerHTML = isPowerSupply
            ? '<div class="empty-bin">N/A (Solid Bin)</div>'
            : '<div class="empty-bin">Loading...</div>';

        dom.binModal.classList.add('active');

        // Fetch stock data
        await this.loadBinContents(cellId, isPowerSupply);
    },

    async loadBinContents(cellId, isPowerSupply) {
        if (isPowerSupply) {
            const loc = state.locations.get(cellId);
            if (loc) {
                const stock = await api.getStockAtLocation(loc.pk);
                dom.binAContent.innerHTML = this.renderStock(stock);
            }
        } else {
            const locA = state.locations.get(`${cellId}-A`);
            const locB = state.locations.get(`${cellId}-B`);

            if (locA) {
                const stockA = await api.getStockAtLocation(locA.pk);
                dom.binAContent.innerHTML = this.renderStock(stockA);
            }

            if (locB) {
                const stockB = await api.getStockAtLocation(locB.pk);
                dom.binBContent.innerHTML = this.renderStock(stockB);
            }
        }
    },

    renderStock(items) {
        if (!items || items.length === 0) {
            return '<div class="empty-bin">No stock</div>';
        }

        return items.map(item => {
            const qty = item.quantity || 0;
            const allocated = item.allocated || 0;
            const available = qty - allocated;
            const hasAllocation = allocated > 0;

            return `
                <div class="stock-item ${hasAllocation ? 'has-allocation' : ''}">
                    <div class="stock-item-name">${item.part_detail?.name || 'Unknown'}</div>
                    <div class="stock-item-meta">
                        <span class="stock-qty ${hasAllocation ? 'partial' : ''}">${available}/${qty}</span>
                        <span class="stock-price">€${(item.purchase_price || 0).toFixed(2)}</span>
                        ${hasAllocation ? `<span class="allocation-badge" title="${allocated} reserved">🔒</span>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    },

    highlightCell(cellId) {
        // Remove previous highlight
        $$('.cell.highlighted').forEach(c => c.classList.remove('highlighted'));

        // Find and highlight
        const cell = document.querySelector(`[data-cell-id="${cellId}"]`);
        if (cell) {
            cell.classList.add('highlighted');
            cell.scrollIntoView({ behavior: 'smooth', block: 'center' });

            setTimeout(() => cell.classList.remove('highlighted'), 2000);
        }
    },

    updateCellStatus(cellId, status, qtyA = null, qtyB = null) {
        const cell = document.querySelector(`[data-cell-id="${cellId}"]`);
        if (!cell) return;

        // Remove old status
        cell.classList.remove('healthy', 'warning', 'critical', 'empty');
        cell.classList.add(status);

        // Update quantities
        const binHalves = cell.querySelectorAll('.bin-half');
        if (binHalves[0] && qtyA !== null) {
            binHalves[0].querySelector('.qty').textContent = qtyA || '-';
        }
        if (binHalves[1] && qtyB !== null) {
            binHalves[1].querySelector('.qty').textContent = qtyB || '-';
        }
    },

    /**
     * Load live stock data for all cells
     */
    async loadLiveData() {
        console.log('📦 Loading live wall data...');

        // Iterate through all grid cells
        for (let zone of ['A', 'B']) {
            for (let col = 1; col <= CONFIG.COLUMNS; col++) {
                for (let level = 1; level <= CONFIG.LEVELS; level++) {
                    const cellId = `${zone}-${col}-${level}`;
                    const isPowerSupply = zone === 'B' && `B-${col}` === CONFIG.POWER_SUPPLY_COLUMN;

                    try {
                        await this.loadCellData(cellId, isPowerSupply);
                    } catch (e) {
                        // Silently continue on individual cell errors
                        console.warn(`Failed to load ${cellId}:`, e);
                    }
                }
            }
        }

        console.log('✓ Wall data loaded');
    },

    /**
     * Load data for a single cell and update its status
     */
    async loadCellData(cellId, isPowerSupply) {
        let totalQty = 0;
        let qtyA = 0;
        let qtyB = 0;

        if (isPowerSupply) {
            // Single bin for power supplies
            const loc = state.locations.get(cellId);
            if (loc) {
                const stock = await api.getStockAtLocation(loc.pk);
                totalQty = stock.reduce((sum, item) => sum + (item.quantity || 0), 0);
                qtyA = totalQty;
            }
            this.updateCellStatus(cellId, this.getStatus(totalQty), qtyA, null);
        } else {
            // Split bins (A = new, B = old)
            const locA = state.locations.get(`${cellId}-A`);
            const locB = state.locations.get(`${cellId}-B`);

            if (locA) {
                const stockA = await api.getStockAtLocation(locA.pk);
                qtyA = stockA.reduce((sum, item) => sum + (item.quantity || 0), 0);
            }

            if (locB) {
                const stockB = await api.getStockAtLocation(locB.pk);
                qtyB = stockB.reduce((sum, item) => sum + (item.quantity || 0), 0);
            }

            totalQty = qtyA + qtyB;
            this.updateCellStatus(cellId, this.getStatus(totalQty), qtyA, qtyB);
        }
    },

    /**
     * Get status class based on quantity
     */
    getStatus(qty) {
        if (qty <= 0) return 'empty';
        if (qty <= 5) return 'critical';
        if (qty <= 15) return 'warning';
        return 'healthy';
    }
};

// =============================================================================
// Barcode Scanner Handler (Enhanced)
// =============================================================================
const scanner = {
    audioCtx: null,
    scanHistory: [],
    MAX_HISTORY: 10,

    init() {
        document.addEventListener('keypress', (e) => this.handleKey(e));
        // Initialize audio context on first user interaction
        document.addEventListener('click', () => this.initAudio(), { once: true });
    },

    initAudio() {
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },

    handleKey(e) {
        // Ignore if focused on input
        if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

        clearTimeout(state.scanTimer);

        if (e.key === 'Enter') {
            if (state.scanBuffer.length > 2) {
                this.process(state.scanBuffer.trim());
            }
            state.scanBuffer = '';
            this.hideIndicator();
            return;
        }

        state.scanBuffer += e.key;
        this.showIndicator();

        state.scanTimer = setTimeout(() => {
            state.scanBuffer = '';
            this.hideIndicator();
        }, CONFIG.SCAN_TIMEOUT);
    },

    showIndicator() {
        dom.scanStatus.classList.add('active');
        dom.scanText.textContent = 'Scanning...';
    },

    hideIndicator() {
        dom.scanStatus.classList.remove('active');
        dom.scanText.textContent = 'Ready';
    },

    /**
     * Play a short beep sound for scan feedback
     */
    playBeep(success = true) {
        if (!CONFIG.SCAN_AUDIO_ENABLED || !this.audioCtx) return;

        const oscillator = this.audioCtx.createOscillator();
        const gainNode = this.audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioCtx.destination);

        oscillator.frequency.value = success ? 880 : 220; // A5 for success, A3 for error
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);

        oscillator.start(this.audioCtx.currentTime);
        oscillator.stop(this.audioCtx.currentTime + 0.1);
    },

    /**
     * Flash the scan status indicator
     */
    flashIndicator(success = true) {
        dom.scanStatus.classList.add(success ? 'flash-success' : 'flash-error');
        setTimeout(() => {
            dom.scanStatus.classList.remove('flash-success', 'flash-error');
        }, 300);
    },

    /**
     * Log scan to history
     */
    logScan(code, type, success) {
        const entry = {
            code,
            type,
            success,
            timestamp: new Date().toISOString()
        };

        this.scanHistory.unshift(entry);
        if (this.scanHistory.length > this.MAX_HISTORY) {
            this.scanHistory.pop();
        }

        console.log('Scan history:', this.scanHistory);
    },

    async process(code) {
        console.log('Scanned:', code);

        // Check if location code
        if (this.isLocation(code)) {
            const locId = this.parseLocation(code);
            wall.highlightCell(locId);
            this.playBeep(true);
            this.flashIndicator(true);
            this.logScan(code, 'location', true);
            toast.show(`Location: ${locId}`);
            return;
        }

        // Otherwise treat as part SKU
        await this.handlePart(code);
    },

    isLocation(code) {
        return /^(LOC-)?[AB]-?\d-?\d(-[AB])?$/i.test(code);
    },

    parseLocation(code) {
        let loc = code.replace(/^LOC-/i, '');

        // Normalize A11A -> A-1-1-A
        if (!loc.includes('-')) {
            const m = loc.match(/([AB])(\d)(\d)([AB])?/i);
            if (m) {
                loc = `${m[1].toUpperCase()}-${m[2]}-${m[3]}`;
                if (m[4]) loc += `-${m[4].toUpperCase()}`;
            }
        }
        return loc;
    },

    async handlePart(sku) {
        try {
            const parts = await api.searchPart(sku);

            if (parts.length === 0) {
                this.playBeep(false);
                this.flashIndicator(false);
                this.logScan(sku, 'part', false);
                toast.show(`Part not found: ${sku}`, true);
                return;
            }

            const part = parts[0];
            state.selectedPart = part;
            this.playBeep(true);
            this.flashIndicator(true);
            this.logScan(sku, 'part', true);
            handshake.show(part);
        } catch (e) {
            this.playBeep(false);
            this.flashIndicator(false);
            this.logScan(sku, 'part', false);
            toast.show(`Error: ${e.message}`, true);
        }
    }
};

// =============================================================================
// Handshake Modal (Receiving & Picking)
// =============================================================================
const handshake = {
    mode: 'receiving', // 'receiving' or 'picking'
    stockItems: [],    // Available stock for picking (FIFO ordered)

    init() {
        dom.handshakeClose.addEventListener('click', () => this.hide());
        dom.handshakeModal.addEventListener('click', (e) => {
            if (e.target === dom.handshakeModal) this.hide();
        });

        dom.handshakeForm.addEventListener('submit', (e) => this.submit(e));

        // Mode toggle via action badge click
        dom.handshakeAction.addEventListener('click', () => this.toggleMode());
    },

    /**
     * Show modal in RECEIVING mode (default from barcode scan)
     */
    show(part) {
        this.mode = 'receiving';
        this.showModal(part);
    },

    /**
     * Show modal in PICKING mode
     */
    async showForPicking(part) {
        this.mode = 'picking';

        // Load available stock for FIFO picking
        try {
            this.stockItems = await api.getStockForPart(part.pk);
            // Sort by location: Bin B first (older stock), then by update date
            this.stockItems.sort((a, b) => {
                const locA = a.location_detail?.name || '';
                const locB = b.location_detail?.name || '';
                // B bins first (FIFO OUT)
                if (locA.endsWith('-B') && !locB.endsWith('-B')) return -1;
                if (!locA.endsWith('-B') && locB.endsWith('-B')) return 1;
                // Then by date (oldest first)
                return new Date(a.updated) - new Date(b.updated);
            });
        } catch (e) {
            this.stockItems = [];
            console.error('Failed to load stock for picking:', e);
        }

        this.showModal(part);
    },

    /**
     * Internal: render modal based on mode
     */
    showModal(part) {
        dom.handshakeAction.textContent = this.mode === 'picking' ? 'PICKING' : 'RECEIVING';
        dom.handshakeAction.classList.toggle('picking', this.mode === 'picking');
        dom.handshakeAction.title = 'Click to toggle mode';

        dom.handshakePartName.textContent = part.name;
        dom.handshakeSKU.textContent = part.IPN || `PK-${part.pk}`;

        dom.inputQty.value = 1;

        // Configure form based on mode
        const sourceUrlGroup = document.getElementById('inputSourceUrl')?.parentElement;
        if (this.mode === 'picking') {
            // Hide price and source URL, populate source bins
            dom.inputPrice.parentElement.style.display = 'none';
            if (sourceUrlGroup) sourceUrlGroup.style.display = 'none';
            this.populateSourceBins();
        } else {
            // Show price and source URL, populate target bins
            dom.inputPrice.parentElement.style.display = 'flex';
            if (sourceUrlGroup) sourceUrlGroup.style.display = 'block';
            dom.inputPrice.value = '';
            const sourceUrlInput = document.getElementById('inputSourceUrl');
            if (sourceUrlInput) sourceUrlInput.value = '';
            this.populateBins();
        }

        // Show form, hide success
        dom.handshakeForm.style.display = 'flex';
        dom.successFeedback.classList.remove('active');

        dom.handshakeModal.classList.add('active');
        dom.inputQty.focus();
    },

    /**
     * Toggle between RECEIVING and PICKING modes
     */
    toggleMode() {
        const part = state.selectedPart;
        if (!part) return;

        if (this.mode === 'receiving') {
            this.showForPicking(part);
        } else {
            this.show(part);
        }
    },

    hide() {
        dom.handshakeModal.classList.remove('active');
        state.selectedPart = null;
        this.stockItems = [];
    },

    /**
     * Populate bins for RECEIVING (target bins) - sorted naturally
     */
    populateBins() {
        dom.inputBin.innerHTML = '<option value="">Select bin...</option>';

        // Get all leaf bins and sort them naturally
        const bins = [];
        for (const [name, loc] of state.locations) {
            // Only show leaf bins (format: A-1-3-A or B-4-7-B)
            if (name.split('-').length >= 3) {
                bins.push({ name, pk: loc.pk });
            }
        }

        // Natural sort: zone, column, level, bin letter
        bins.sort((a, b) => {
            const partsA = a.name.split('-');
            const partsB = b.name.split('-');

            // Zone (A/B)
            if (partsA[0] !== partsB[0]) return partsA[0].localeCompare(partsB[0]);
            // Column (1-8)
            const colA = parseInt(partsA[1]) || 0;
            const colB = parseInt(partsB[1]) || 0;
            if (colA !== colB) return colA - colB;
            // Level (1-7)
            const lvlA = parseInt(partsA[2]) || 0;
            const lvlB = parseInt(partsB[2]) || 0;
            if (lvlA !== lvlB) return lvlA - lvlB;
            // Bin letter (A/B)
            return (partsA[3] || '').localeCompare(partsB[3] || '');
        });

        bins.forEach(({ name, pk }) => {
            const opt = document.createElement('option');
            opt.value = pk;
            opt.textContent = name;
            dom.inputBin.appendChild(opt);
        });
    },

    /**
     * Populate bins for PICKING (source bins with stock)
     */
    populateSourceBins() {
        dom.inputBin.innerHTML = '<option value="">Auto (FIFO)</option>';

        // Add stock items as options
        this.stockItems.forEach(item => {
            if (item.quantity > 0) {
                const opt = document.createElement('option');
                opt.value = item.pk;
                opt.textContent = `${item.location_detail?.name || 'Unknown'} (${item.quantity} @ €${(item.purchase_price || 0).toFixed(2)})`;
                opt.dataset.qty = item.quantity;
                dom.inputBin.appendChild(opt);
            }
        });
    },

    async submit(e) {
        e.preventDefault();

        if (this.mode === 'picking') {
            await this.submitPick();
        } else {
            await this.submitReceive();
        }
    },

    /**
     * Handle RECEIVING submission with FIFO Auto-Rotation
     * New stock goes to Bin A, pushing old Bin A stock to Bin B
     */
    async submitReceive() {
        const partId = state.selectedPart?.pk;
        const locationId = dom.inputBin.value;
        const qty = parseInt(dom.inputQty.value);
        const price = parseFloat(dom.inputPrice.value) || 0;

        if (!partId || !locationId) {
            toast.show('Missing required fields', true);
            return;
        }

        try {
            // Get the selected location details to determine which bin it is
            const selectedLocation = [...state.locations.values()].find(loc => loc.pk === parseInt(locationId));
            if (!selectedLocation) {
                throw new Error('Invalid location');
            }

            const locName = selectedLocation.name;

            // FIFO Auto-Rotation Logic
            // If receiving to Bin A (e.g., A-1-3-A), check if there's existing stock
            // If yes, move it to corresponding Bin B (A-1-3-B) before adding new stock
            if (locName.endsWith('-A')) {
                console.log(`🔄 FIFO rotation: Receiving to ${locName} (Bin A)`);

                // Find corresponding Bin B
                const binBName = locName.slice(0, -1) + 'B'; // Replace -A with -B
                const binBLocation = [...state.locations.entries()].find(([name]) => name === binBName);

                if (binBLocation) {
                    const binBId = binBLocation[1].pk;

                    // Check for existing stock in Bin A for this part
                    const existingStockA = await api.getStockAtLocation(locationId);
                    const partStockInA = existingStockA.filter(item => item.part === partId);

                    if (partStockInA.length > 0) {
                        console.log(`  📦 Found ${partStockInA.length} existing batch(es) in Bin A, moving to Bin B...`);

                        // Move all existing Bin A stock to Bin B
                        for (const stockItem of partStockInA) {
                            await this.moveStock(stockItem.pk, binBId, stockItem.quantity);
                            console.log(`  ✓ Moved ${stockItem.quantity} units (€${stockItem.purchase_price}) to ${binBName}`);
                        }

                        toast.show(`Rotated old batch to Bin B`, 'info');
                    } else {
                        console.log(`  ℹ️ No existing stock in Bin A, direct placement`);
                    }
                } else {
                    console.warn(`  ⚠️ Bin B not found for rotation (${binBName})`);
                }
            }

            // Create new stock at the selected location (now Bin A is clear if rotation happened)
            const sourceUrl = document.getElementById('inputSourceUrl')?.value?.trim() || '';
            await api.createStock(partId, locationId, qty, price, sourceUrl ? `Source: ${sourceUrl}` : '');

            // Show success
            dom.handshakeForm.style.display = 'none';
            dom.successFeedback.classList.add('active');

            setTimeout(() => {
                this.hide();
                toast.show(`Received ${qty} × ${state.selectedPart.name}`);
                // Refresh wall data
                wall.loadLiveData();
            }, 800);

        } catch (e) {
            console.error('Receiving error:', e);
            toast.show(`Failed: ${e.message}`, true);
        }
    },

    /**
     * Move stock from one location to another
     * @param {number} stockItemId - Stock item ID to move
     * @param {number} newLocationId - Destination location ID
     * @param {number} quantity - Quantity to transfer
     */
    async moveStock(stockItemId, newLocationId, quantity) {
        // InvenTree stock transfer endpoint: POST /api/stock/transfer/
        const response = await fetch(`${CONFIG.API_BASE}/stock/transfer/`, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${CONFIG.API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                items: [{
                    pk: stockItemId,
                    quantity: quantity
                }],
                location: newLocationId,
                notes: 'FIFO Auto-Rotation: Old → Bin B'
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Transfer failed: ${error}`);
        }

        return await response.json();
    },

    /**
     * Handle PICKING submission with FIFO logic
     * Consumes from Bin B (oldest) first, then Bin A (newest)
     */
    async submitPick() {
        const qty = parseInt(dom.inputQty.value);
        const selectedStockId = dom.inputBin.value;

        if (qty <= 0) {
            toast.show('Invalid quantity', true);
            return;
        }

        try {
            let remaining = qty;
            const consumed = [];

            if (selectedStockId) {
                // Pick from specific stock item
                const item = this.stockItems.find(s => s.pk === parseInt(selectedStockId));
                if (item && item.quantity >= qty) {
                    await api.removeStock(item.pk, qty);
                    consumed.push({
                        bin: item.location_detail?.name,
                        qty,
                        price: item.purchase_price
                    });
                    remaining = 0;
                } else {
                    toast.show('Insufficient stock in selected bin', true);
                    return;
                }
            } else {
                // FIFO Auto-pick: Explicit Bin B priority (oldest first)
                // Sort stock items: Bin B (-B suffix) before Bin A (-A suffix)
                const sortedStock = [...this.stockItems].sort((a, b) => {
                    const nameA = a.location_detail?.name || '';
                    const nameB = b.location_detail?.name || '';

                    // Bin B (-B) gets priority (comes first)
                    const isBinB_A = nameA.endsWith('-B');
                    const isBinB_B = nameB.endsWith('-B');

                    if (isBinB_A && !isBinB_B) return -1;  // A is Bin B, comes first
                    if (!isBinB_A && isBinB_B) return 1;   // B is Bin B, B comes first

                    // Both same type (both -A or both -B), sort by created date (oldest first)
                    return new Date(a.stocktake_date || 0) - new Date(b.stocktake_date || 0);
                });

                console.log('🔄 FIFO Picking Order:', sortedStock.map(s => `${s.location_detail?.name} (${s.quantity} @ €${s.purchase_price})`));

                for (const item of sortedStock) {
                    if (remaining <= 0) break;
                    if (item.quantity <= 0) continue;

                    const toConsume = Math.min(remaining, item.quantity);
                    await api.removeStock(item.pk, toConsume);
                    consumed.push({
                        bin: item.location_detail?.name,
                        qty: toConsume,
                        price: item.purchase_price
                    });
                    remaining -= toConsume;

                    console.log(`  ✓ Consumed ${toConsume} from ${item.location_detail?.name} @ €${item.purchase_price}`);
                }
            }

            if (remaining > 0) {
                toast.show(`Only picked ${qty - remaining} of ${qty} (insufficient stock)`, true);
            } else {
                // Show success
                dom.handshakeForm.style.display = 'none';
                dom.successFeedback.classList.add('active');

                const summary = consumed.map(c => `${c.qty} from ${c.bin}`).join(', ');
                setTimeout(() => {
                    this.hide();
                    toast.show(`Picked ${qty} × ${state.selectedPart.name}`);
                    console.log('FIFO consumed:', summary);
                    // Refresh wall data
                    wall.loadLiveData();
                }, 800);
            }

        } catch (e) {
            toast.show(`Pick failed: ${e.message}`, true);
        }
    }
};

// =============================================================================
// Catalog Module (Enhanced with CRUD)
// =============================================================================
const catalog = {
    searchDebounce: null,
    categories: [],
    filterCategory: '',

    init() {
        // Search input
        if (dom.catalogSearch) {
            dom.catalogSearch.addEventListener('input', (e) => {
                clearTimeout(this.searchDebounce);
                this.searchDebounce = setTimeout(() => {
                    this.render();
                }, 200);
            });
        }

        // Category filter
        const categoryFilter = document.getElementById('catalogCategoryFilter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                this.filterCategory = e.target.value;
                this.render();
            });
        }

        // FAB button
        const addBtn = document.getElementById('btnAddPart');
        if (addBtn) {
            addBtn.addEventListener('click', () => partManager.showCreate());
        }

        // Load categories
        this.loadCategories();
    },

    async loadCategories() {
        try {
            this.categories = await api.getCategories();
            this.populateCategoryFilter();
        } catch (e) {
            console.warn('Failed to load categories:', e);
        }
    },

    populateCategoryFilter() {
        const filter = document.getElementById('catalogCategoryFilter');
        if (!filter) return;

        // Keep "All Categories" option
        filter.innerHTML = '<option value="">All Categories</option>';

        this.categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.pk;
            opt.textContent = cat.name;
            filter.appendChild(opt);
        });
    },

    render() {
        if (!dom.catalogGrid) return;

        const searchQuery = (dom.catalogSearch?.value || '').toLowerCase().trim();
        let parts = Array.from(state.parts.values());

        // Filter by search
        if (searchQuery) {
            parts = parts.filter(p =>
                (p.name?.toLowerCase().includes(searchQuery)) ||
                (p.IPN?.toLowerCase().includes(searchQuery)) ||
                (p.description?.toLowerCase().includes(searchQuery))
            );
        }

        // Filter by category
        if (this.filterCategory) {
            parts = parts.filter(p => p.category == this.filterCategory);
        }

        if (parts.length === 0) {
            dom.catalogGrid.innerHTML = `
                <div class="catalog-empty">
                    <span>${searchQuery ? '🔍' : '📦'}</span>
                    <p>${searchQuery ? `No parts matching "${searchQuery}"` : 'No parts in inventory. Click + to add one.'}</p>
                </div>
            `;
            return;
        }

        dom.catalogGrid.innerHTML = parts.map(p => this.createCard(p)).join('');

        // Attach card event listeners
        this.attachCardListeners();
    },

    attachCardListeners() {
        document.querySelectorAll('.part-card').forEach(card => {
            const partId = card.dataset.partId;
            const mainSection = card.querySelector('.part-card-main');

            // Edit button
            const editBtn = card.querySelector('.part-card-action.edit');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const part = state.parts.get(parseInt(partId));
                    if (part) partManager.showEdit(part);
                });
            }

            // Delete button
            const deleteBtn = card.querySelector('.part-card-action.delete');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const part = state.parts.get(parseInt(partId));
                    if (part) partManager.showDelete(part);
                });
            }

            // Main section click - toggle batch expansion
            if (mainSection) {
                mainSection.addEventListener('click', async (e) => {
                    // Don't toggle if clicking action buttons
                    if (e.target.closest('.part-card-actions')) return;

                    const isExpanded = card.classList.toggle('expanded');
                    if (isExpanded) {
                        // Load batches for this part
                        await this.loadBatches(parseInt(partId));
                    }
                });
            }

            // Add Batch button
            const addBatchBtn = card.querySelector('.btn-add-batch');
            if (addBatchBtn) {
                addBatchBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const part = state.parts.get(parseInt(partId));
                    if (part) {
                        state.selectedPart = part;
                        handshake.show(part);
                    }
                });
            }
        });
    },

    /**
     * Load and display batches (stock items) for a part
     */
    async loadBatches(partId) {
        const batchList = document.querySelector(`.batch-list[data-part-id="${partId}"]`);
        if (!batchList) return;

        try {
            const stocks = await api.getStockForPart(partId);
            if (stocks.length === 0) {
                batchList.innerHTML = '<div class="batch-empty">No batches yet</div>';
                return;
            }

            // Render batches with edit button
            batchList.innerHTML = stocks.map((stock, idx) => {
                const qty = stock.quantity || 0;
                const price = stock.purchase_price || 0;
                const location = stock.location_detail?.name || 'Unknown';
                const batchLabel = String.fromCharCode(65 + idx); // A, B, C...

                return `
                    <div class="batch-item" data-stock-id="${stock.pk}">
                        <div class="batch-label">Batch ${batchLabel}</div>
                        <div class="batch-location">${location}</div>
                        <div class="batch-details">
                            <span class="batch-qty">${qty} units</span>
                            <span class="batch-price">€${parseFloat(price).toFixed(2)}</span>
                        </div>
                        <button class="batch-edit-btn" data-stock-id="${stock.pk}" title="Edit Batch">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                    </div>
                `;
            }).join('');

            // Attach edit button listeners
            batchList.querySelectorAll('.batch-edit-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const stockId = parseInt(btn.dataset.stockId);
                    const stockItem = stocks.find(s => s.pk === stockId);
                    if (stockItem) {
                        batchEditor.show(stockItem);
                    }
                });
            });
        } catch (e) {
            batchList.innerHTML = '<div class="batch-error">Failed to load batches</div>';
            console.error('Error loading batches:', e);
        }
    },

    createCard(part) {
        const sku = part.IPN || `PK-${part.pk}`;
        const minStock = part.minimum_stock || 0;
        const inStock = part.in_stock ?? 0;

        // Determine stock status
        let statusClass = 'empty';
        let statusText = 'No Stock';

        if (inStock > 0) {
            if (minStock > 0 && inStock < minStock * 0.5) {
                statusClass = 'critical';
                statusText = 'Critical';
            } else if (minStock > 0 && inStock < minStock) {
                statusClass = 'warning';
                statusText = 'Low Stock';
            } else {
                statusClass = 'healthy';
                statusText = 'In Stock';
            }
        }

        return `
            <div class="part-card" data-part-id="${part.pk}">
                <div class="part-card-main">
                    <div class="part-card-actions">
                        <button class="part-card-action edit" title="Edit Part">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                        <button class="part-card-action delete" title="Delete Part">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                        </button>
                    </div>
                    <div class="part-card-header">
                        <span class="part-sku">${sku}</span>
                        <span class="stock-badge ${statusClass}">${statusText}</span>
                    </div>
                    <div class="part-card-body">
                        <h3 class="part-name">${part.name || 'Unnamed Part'}</h3>
                        <p class="part-desc">${part.description || 'No description'}</p>
                    </div>
                    <div class="part-card-footer">
                        <div class="part-stock">
                            <span class="stock-qty">${inStock}</span>
                            <span class="stock-label">in stock</span>
                        </div>
                        ${minStock > 0 ? `
                            <div class="part-min">
                                <span class="min-qty">${minStock}</span>
                                <span class="min-label">min</span>
                            </div>
                        ` : ''}
                        <div class="part-expand-toggle">
                            <svg class="expand-chevron" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                        </div>
                    </div>
                </div>
                <div class="part-card-batches">
                    <div class="batch-list" data-part-id="${part.pk}">
                        <div class="batch-loading">Loading batches...</div>
                    </div>
                    <button class="btn-add-batch" data-part-id="${part.pk}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Add Batch
                    </button>
                </div>
            </div>
        `;
    }
};

// =============================================================================
// Batch Editor (Edit Stock Item)
// =============================================================================
const batchEditor = {
    currentStock: null,

    init() {
        const modal = document.getElementById('batchEditModal');
        const closeBtn = document.getElementById('batchEditClose');
        const cancelBtn = document.getElementById('batchEditCancel');
        const form = document.getElementById('batchEditForm');

        if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.hide());
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.hide();
            });
        }
        if (form) form.addEventListener('submit', (e) => this.submit(e));
    },

    show(stockItem) {
        this.currentStock = stockItem;
        const modal = document.getElementById('batchEditModal');

        // Populate form
        document.getElementById('batchEditQty').value = stockItem.quantity || 0;
        document.getElementById('batchEditPrice').value = stockItem.purchase_price || 0;

        // Show current location in readonly info
        const currentLocName = stockItem.location_detail?.name || 'Unknown';
        document.getElementById('batchEditLocation').textContent = currentLocName;

        // Show part name
        const partName = stockItem.part_detail?.name || 'Unknown Part';
        document.getElementById('batchEditPartName').textContent = partName;

        // Populate location dropdown
        const locSelect = document.getElementById('batchEditLocationSelect');
        locSelect.innerHTML = '<option value="">Select new location...</option>';

        // Add all locations (only Bin A/B bins for FIFO system)
        for (const [name, loc] of state.locations.entries()) {
            if (name.match(/^[AB]-\d-\d-[AB]$/)) {  // Only show bins (e.g. A-1-1-A, B-2-3-B)
                const option = new Option(name, loc.pk);
                // Mark current location
                if (loc.pk === stockItem.location) {
                    option.text += ' (current)';
                    option.disabled = true;
                }
                locSelect.appendChild(option);
            }
        }

        modal.classList.add('active');
        document.getElementById('batchEditQty').focus();
    },

    hide() {
        document.getElementById('batchEditModal').classList.remove('active');
        this.currentStock = null;
    },

    async submit(e) {
        e.preventDefault();

        if (!this.currentStock) return;

        const qty = parseFloat(document.getElementById('batchEditQty').value);
        const price = parseFloat(document.getElementById('batchEditPrice').value);
        const newLocationId = document.getElementById('batchEditLocationSelect').value;

        // Manual validation (since form has novalidate)
        if (isNaN(qty) || qty < 0) {
            toast.show('Please enter a valid quantity', 'error');
            return;
        }
        if (isNaN(price) || price < 0) {
            toast.show('Please enter a valid price', 'error');
            return;
        }

        try {
            // Check if location changed
            const locationChanged = newLocationId && parseInt(newLocationId) !== this.currentStock.location;

            if (locationChanged) {
                console.log(`📦 Location change detected: moving stock to new location`);

                // Transfer stock to new location
                await handshake.moveStock(this.currentStock.pk, parseInt(newLocationId), qty);
                toast.show('Batch moved to new location', 'success');
            }

            // Update quantity and price (even if only those changed)
            await api.request(`/stock/${this.currentStock.pk}/`, {
                method: 'PATCH',
                body: JSON.stringify({
                    quantity: qty,
                    purchase_price: price
                })
            });

            toast.show('Batch updated successfully', 'success');
            this.hide();

            // Refresh the catalog and wall to show updated data
            await loadParts();
            catalog.render();

            // Reload batches for the currently expanded part if in catalog
            if (state.expandedPart) {
                await catalog.loadBatches(state.expandedPart);
            }

            wall.loadLiveData();

        } catch (e) {
            console.error('Batch update error:', e);
            toast.show('Failed to update batch', 'error');
        }
    }
};

// =============================================================================
// Part Manager (CRUD Modal Handler)
// =============================================================================
const partManager = {
    mode: 'create', // 'create' or 'edit'
    currentPart: null,
    deleteCallback: null,

    init() {
        // Part Modal
        const modal = document.getElementById('partModal');
        const closeBtn = document.getElementById('partModalClose');
        const cancelBtn = document.getElementById('partFormCancel');
        const form = document.getElementById('partForm');

        if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.hide());
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.hide();
            });
        }
        if (form) form.addEventListener('submit', (e) => this.submit(e));

        // Delete Modal
        const deleteModal = document.getElementById('deleteModal');
        const deleteCancelBtn = document.getElementById('deleteCancelBtn');
        const deleteConfirmBtn = document.getElementById('deleteConfirmBtn');

        if (deleteCancelBtn) deleteCancelBtn.addEventListener('click', () => this.hideDelete());
        if (deleteConfirmBtn) deleteConfirmBtn.addEventListener('click', () => this.confirmDelete());
        if (deleteModal) {
            deleteModal.addEventListener('click', (e) => {
                if (e.target === deleteModal) this.hideDelete();
            });
        }

        // JIT Reorder Point live calculation
        const jitInputs = ['partMinStock', 'partDeliveryDays', 'partAvgSoldDay'];
        jitInputs.forEach(id => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('input', () => this.updateJitDisplay());
            }
        });
    },

    showCreate() {
        this.mode = 'create';
        this.currentPart = null;
        this.resetForm();
        this.populateCategories();
        this.populateLocations();

        document.getElementById('partModalAction').textContent = 'NEW PART';
        document.getElementById('partModalTitle').textContent = 'Add Part';
        document.getElementById('partFormLabel').textContent = 'Create Part';

        // Show Initial Stock section for new parts
        document.getElementById('initialStockSection').style.display = 'flex';
        document.getElementById('initialStockFields').style.display = 'grid';
        document.getElementById('fifoHint').style.display = 'block';

        document.getElementById('partModal').classList.add('active');
        document.getElementById('partName').focus();
    },

    showEdit(part) {
        this.mode = 'edit';
        this.currentPart = part;
        this.populateCategories();

        document.getElementById('partModalAction').textContent = 'EDIT';
        document.getElementById('partModalTitle').textContent = 'Edit Part';
        document.getElementById('partFormLabel').textContent = 'Save Changes';

        // Fill form
        document.getElementById('partName').value = part.name || '';
        document.getElementById('partIPN').value = part.IPN || '';
        document.getElementById('partDescription').value = part.description || '';
        document.getElementById('partCategory').value = part.category || '';
        document.getElementById('partMinStock').value = part.minimum_stock || 0;

        // Load JIT config from localStorage
        const jitConfig = this.getJitConfig(part.pk);
        document.getElementById('partDeliveryDays').value = jitConfig.delivery_days || 3;
        document.getElementById('partAvgSoldDay').value = jitConfig.avg_sold_day || 0;
        this.updateJitDisplay();

        // Hide Initial Stock section for existing parts (use Receiving modal instead)
        document.getElementById('initialStockSection').style.display = 'none';
        document.getElementById('initialStockFields').style.display = 'none';
        document.getElementById('fifoHint').style.display = 'none';

        document.getElementById('partModal').classList.add('active');
        document.getElementById('partName').focus();
    },

    hide() {
        document.getElementById('partModal').classList.remove('active');
        this.currentPart = null;
    },

    resetForm() {
        document.getElementById('partName').value = '';
        document.getElementById('partIPN').value = '';
        document.getElementById('partDescription').value = '';
        document.getElementById('partCategory').value = '';
        document.getElementById('partMinStock').value = '0';
        // JIT fields
        document.getElementById('partDeliveryDays').value = '3';
        document.getElementById('partAvgSoldDay').value = '0';
        this.updateJitDisplay();
        // Initial Stock fields
        document.getElementById('partLocation').value = '';
        document.getElementById('partInitialQty').value = '1';
        document.getElementById('partPurchasePrice').value = '';
    },

    /**
     * Populate shelf locations dropdown with all bins
     * Shows bins like A-1-3-A, A-1-3-B, B-4-1 (power supplies)
     */
    populateLocations() {
        const select = document.getElementById('partLocation');
        if (!select) return;

        select.innerHTML = '<option value="">Select bin...</option>';

        // Collect all leaf bins (locations with A/B suffix or solid bins like B-4-x)
        const bins = [];
        for (const [name, loc] of state.locations) {
            const parts = name.split('-');
            // Bin format: A-1-3-A or A-1-3-B (4 parts) OR B-4-x (3 parts for power supplies)
            if (parts.length === 4 || (parts.length === 3 && parts[0] === 'B' && parts[1] === '4')) {
                bins.push({ name, pk: loc.pk });
            }
        }

        // Natural sort: zone, column, level, bin letter
        bins.sort((a, b) => {
            const pa = a.name.split('-');
            const pb = b.name.split('-');

            // Zone (A/B)
            if (pa[0] !== pb[0]) return pa[0].localeCompare(pb[0]);
            // Column (1-4)
            const colA = parseInt(pa[1]) || 0;
            const colB = parseInt(pb[1]) || 0;
            if (colA !== colB) return colA - colB;
            // Level (1-7)
            const lvlA = parseInt(pa[2]) || 0;
            const lvlB = parseInt(pb[2]) || 0;
            if (lvlA !== lvlB) return lvlA - lvlB;
            // Bin letter (A/B)
            return (pa[3] || '').localeCompare(pb[3] || '');
        });

        bins.forEach(({ name, pk }) => {
            const opt = document.createElement('option');
            opt.value = pk;
            opt.textContent = name;
            select.appendChild(opt);
        });

        console.log(`📦 Loaded ${bins.length} bins into location dropdown`);
    },

    /**
     * Calculate and update JIT Reorder Point display
     * Formula: (avg_delivery_days * avg_sold_per_day) + minimum_stock
     */
    updateJitDisplay() {
        const minStock = parseFloat(document.getElementById('partMinStock')?.value) || 0;
        const deliveryDays = parseFloat(document.getElementById('partDeliveryDays')?.value) || 0;
        const avgSoldDay = parseFloat(document.getElementById('partAvgSoldDay')?.value) || 0;

        const rop = Math.ceil((deliveryDays * avgSoldDay) + minStock);

        const display = document.getElementById('jitRoPDisplay');
        if (display) {
            display.textContent = rop;
            // Color based on value
            if (rop === 0) {
                display.style.background = 'var(--text-muted)';
            } else {
                display.style.background = 'var(--accent)';
            }
        }
        return rop;
    },

    /**
     * Get JIT config from localStorage
     */
    getJitConfig(partPk) {
        try {
            const config = JSON.parse(localStorage.getItem('jit_config') || '{}');
            return config[partPk] || { delivery_days: 3, avg_sold_day: 0 };
        } catch {
            return { delivery_days: 3, avg_sold_day: 0 };
        }
    },

    /**
     * Save JIT config to localStorage
     */
    saveJitConfig(partPk, deliveryDays, avgSoldDay) {
        try {
            const config = JSON.parse(localStorage.getItem('jit_config') || '{}');
            config[partPk] = { delivery_days: deliveryDays, avg_sold_day: avgSoldDay };
            localStorage.setItem('jit_config', JSON.stringify(config));
        } catch (e) {
            console.warn('Failed to save JIT config:', e);
        }
    },

    populateCategories() {
        const select = document.getElementById('partCategory');
        if (!select) return;

        select.innerHTML = '<option value="">No Category</option>';
        catalog.categories.forEach(cat => {
            const opt = document.createElement('option');
            opt.value = cat.pk;
            opt.textContent = cat.name;
            select.appendChild(opt);
        });
    },

    async submit(e) {
        e.preventDefault();

        const data = {
            name: document.getElementById('partName').value.trim(),
            ipn: document.getElementById('partIPN').value.trim(),
            description: document.getElementById('partDescription').value.trim(),
            category: document.getElementById('partCategory').value || null,
            minimum_stock: parseInt(document.getElementById('partMinStock').value) || 0
        };

        // JIT data (stored locally)
        const jitData = {
            delivery_days: parseFloat(document.getElementById('partDeliveryDays').value) || 3,
            avg_sold_day: parseFloat(document.getElementById('partAvgSoldDay').value) || 0
        };

        // Initial Stock data (for new parts only)
        const stockData = this.mode === 'create' ? {
            location: document.getElementById('partLocation').value,
            quantity: parseInt(document.getElementById('partInitialQty').value) || 0,
            purchasePrice: parseFloat(document.getElementById('partPurchasePrice').value) || 0
        } : null;

        if (!data.name || !data.ipn) {
            toast.show('Name and SKU are required', true);
            return;
        }

        // Validate Initial Stock for new parts
        if (this.mode === 'create' && (!stockData.location || stockData.quantity < 1)) {
            toast.show('Shelf location and quantity are required', true);
            return;
        }

        try {
            let partPk;
            if (this.mode === 'create') {
                const result = await api.createPart(data);
                partPk = result.pk;

                // stockData.location is already a bin PK from the dropdown
                // Just create stock at the selected location directly
                if (stockData.location && stockData.quantity > 0) {
                    await api.createStock(partPk, stockData.location, stockData.quantity, stockData.purchasePrice);

                    // Find bin name for toast message
                    let binName = 'selected bin';
                    for (const [name, loc] of state.locations) {
                        if (loc.pk == stockData.location) {
                            binName = name;
                            break;
                        }
                    }
                    toast.show(`Created: ${data.name} → ${binName} (${stockData.quantity}x)`);
                } else {
                    toast.show(`Created: ${data.name}`);
                }
            } else {
                await api.updatePart(this.currentPart.pk, data);
                partPk = this.currentPart.pk;
                toast.show(`Updated: ${data.name}`);
            }

            // Save JIT config
            this.saveJitConfig(partPk, jitData.delivery_days, jitData.avg_sold_day);

            this.hide();

            // Refresh parts list
            await loadParts();
            catalog.render();

        } catch (e) {
            toast.show(`Error: ${e.message}`, true);
        }
    },

    showDelete(part) {
        this.currentPart = part;
        document.getElementById('deleteModalTitle').textContent = `Delete "${part.name}"?`;
        document.getElementById('deleteModal').classList.add('active');
    },

    hideDelete() {
        document.getElementById('deleteModal').classList.remove('active');
    },

    async confirmDelete() {
        if (!this.currentPart) return;

        try {
            // InvenTree requires parts to be inactive before deletion
            // First, mark the part as inactive
            await api.request(`/part/${this.currentPart.pk}/`, {
                method: 'PATCH',
                body: JSON.stringify({ active: false })
            });

            // Now delete the inactive part
            await api.deletePart(this.currentPart.pk);
            toast.show(`Deleted: ${this.currentPart.name}`, 'success');

            this.hideDelete();
            this.currentPart = null;

            // Refresh parts list
            await loadParts();
            catalog.render();

        } catch (e) {
            console.error('Delete error:', e);
            toast.show(`Delete failed: ${e.message}`, 'error');
        }
    }
};

// =============================================================================
// Bin Modal
// =============================================================================
const binModal = {
    currentCellId: null,

    init() {
        dom.binModalClose.addEventListener('click', () => this.hide());
        dom.binModal.addEventListener('click', (e) => {
            if (e.target === dom.binModal) this.hide();
        });

        // Print label button
        const printBtn = document.getElementById('btnPrintBinLabel');
        if (printBtn) {
            printBtn.addEventListener('click', () => {
                if (this.currentCellId && typeof labels !== 'undefined') {
                    labels.printLocationLabel(this.currentCellId);
                }
            });
        }
    },

    hide() {
        dom.binModal.classList.remove('active');
        this.currentCellId = null;
    }
};

// =============================================================================
// Toast
// =============================================================================
const toast = {
    show(message, isError = false) {
        dom.toastMessage.textContent = message;
        dom.toast.classList.toggle('error', isError);
        dom.toast.classList.add('active');

        setTimeout(() => dom.toast.classList.remove('active'), 3000);
    }
};

// =============================================================================
// Low Stock Alerts System
// =============================================================================
const alerts = {
    lowStockItems: [],
    alertCount: 0,

    /**
     * Initialize alerts system
     */
    init() {
        // Create alert widget in sidebar
        this.createWidget();
    },

    /**
     * Create alert widget in DOM
     */
    createWidget() {
        const sidebar = document.querySelector('.sidebar');
        if (!sidebar || document.getElementById('alertWidget')) return;

        const widget = document.createElement('div');
        widget.id = 'alertWidget';
        widget.className = 'alert-widget';
        widget.innerHTML = `
            <div class="alert-badge" id="alertBadge" style="display: none;">
                <span class="alert-count">0</span>
            </div>
            <div class="alert-panel" id="alertPanel">
                <div class="alert-header">
                    <span>⚠️ Low Stock</span>
                    <button class="alert-close" id="alertClose">×</button>
                </div>
                <div class="alert-list" id="alertList">
                    <div class="empty-alerts">No alerts</div>
                </div>
            </div>
        `;

        sidebar.appendChild(widget);

        // Event listeners
        const badge = document.getElementById('alertBadge');
        const panel = document.getElementById('alertPanel');
        const closeBtn = document.getElementById('alertClose');

        badge?.addEventListener('click', () => {
            panel?.classList.toggle('active');
        });

        closeBtn?.addEventListener('click', () => {
            panel?.classList.remove('active');
        });
    },

    /**
     * Check all parts for low stock
     */
    async checkLowStock() {
        this.lowStockItems = [];

        for (const [pk, part] of state.parts) {
            const minStock = part.minimum_stock || 0;
            if (minStock <= 0) continue; // Skip parts without minimum

            try {
                const { available } = await api.getAvailableStock(pk);

                if (available < minStock) {
                    this.lowStockItems.push({
                        pk,
                        name: part.name,
                        sku: part.IPN || `PK-${pk}`,
                        available,
                        minimum: minStock,
                        shortage: minStock - available
                    });
                }
            } catch (e) {
                // Ignore individual part errors
            }
        }

        this.alertCount = this.lowStockItems.length;
        this.updateWidget();
        this.updateWallCells();

        if (this.alertCount > 0) {
            console.log(`⚠️ ${this.alertCount} parts below minimum stock`);
        }

        return this.lowStockItems;
    },

    /**
     * Update the alert widget UI
     */
    updateWidget() {
        const badge = document.getElementById('alertBadge');
        const countEl = badge?.querySelector('.alert-count');
        const listEl = document.getElementById('alertList');

        if (badge && countEl) {
            if (this.alertCount > 0) {
                badge.style.display = 'flex';
                countEl.textContent = this.alertCount;
                badge.classList.add('pulse');
            } else {
                badge.style.display = 'none';
                badge.classList.remove('pulse');
            }
        }

        if (listEl) {
            if (this.lowStockItems.length === 0) {
                listEl.innerHTML = '<div class="empty-alerts">All stock levels OK</div>';
            } else {
                listEl.innerHTML = this.lowStockItems.map(item => `
                    <div class="alert-item">
                        <div class="alert-item-name">${item.name}</div>
                        <div class="alert-item-detail">
                            <span class="stock-critical">${item.available}</span>
                            <span class="stock-separator">/</span>
                            <span class="stock-min">${item.minimum}</span>
                        </div>
                    </div>
                `).join('');
            }
        }
    },

    /**
     * Update Wall cell colors based on stock levels
     */
    updateWallCells() {
        // This would update Wall cells when we have live stock data
        // For now, just log the warning state
        this.lowStockItems.forEach(item => {
            console.log(`📦 Low stock: ${item.name} (${item.available}/${item.minimum})`);
        });
    }
};

// =============================================================================
// Data Loading
// =============================================================================
async function loadLocations() {
    try {
        const locs = await api.getLocations();
        state.locations.clear();
        locs.forEach(l => state.locations.set(l.name, l));
        console.log(`Loaded ${locs.length} locations`);
    } catch (e) {
        console.error('Failed to load locations:', e);
    }
}

async function loadParts() {
    try {
        const parts = await api.getParts();
        state.parts.clear();
        parts.forEach(p => state.parts.set(p.pk, p));
        console.log(`Loaded ${parts.length} parts`);
    } catch (e) {
        console.error('Failed to load parts:', e);
    }
}

async function checkConnection() {
    try {
        await api.request('/');
        state.isConnected = true;
        console.log('✓ API Connected');
    } catch {
        state.isConnected = false;
        console.warn('✗ API Offline');
    }
}

// =============================================================================
// Keyboard Shortcuts
// =============================================================================
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        dom.binModal.classList.remove('active');
        dom.handshakeModal.classList.remove('active');
        document.getElementById('partModal')?.classList.remove('active');
        document.getElementById('deleteModal')?.classList.remove('active');
    }
});

// =============================================================================
// Initialize
// =============================================================================
async function init() {
    console.log('🚀 Omiximo Inventory OS starting...');

    // Clock
    updateClock();
    setInterval(updateClock, 1000);

    // Theme
    theme.init();

    // Router
    router.init();

    // Wall
    wall.init();

    // Modals
    binModal.init();
    handshake.init();
    partManager.init();
    batchEditor.init();

    // Scanner
    scanner.init();

    // Alerts
    alerts.init();

    // Catalog
    catalog.init();

    // Check for saved token
    const savedToken = localStorage.getItem('inventree_token');
    if (savedToken) {
        CONFIG.API_TOKEN = savedToken;
        const isValid = await auth.validateToken();
        if (isValid) {
            auth.onAuthSuccess();
            return;
        }
        // Token invalid, show login
        localStorage.removeItem('inventree_token');
    }

    // Show login modal
    document.body.classList.add('not-authenticated');
    document.getElementById('loginModal').classList.add('active');
    document.getElementById('loginUser').focus();

    console.log('⏳ Waiting for authentication...');
}

// =============================================================================
// Auth Module
// =============================================================================
const auth = {
    /**
     * Get authorization headers for API requests
     * @returns {Object} Headers object with Content-Type, Accept, and Authorization
     */
    getHeaders() {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (CONFIG.API_TOKEN) {
            headers['Authorization'] = `Token ${CONFIG.API_TOKEN}`;
        }
        return headers;
    },

    init() {
        const form = document.getElementById('loginForm');
        if (form) {
            form.addEventListener('submit', (e) => this.handleLogin(e));
        }
    },

    async handleLogin(e) {
        e.preventDefault();

        const user = document.getElementById('loginUser').value.trim();
        const pass = document.getElementById('loginPass').value;
        const errorEl = document.getElementById('loginError');
        const btnText = document.getElementById('loginBtnText');
        const spinner = document.getElementById('loginSpinner');

        // Show loading
        btnText.textContent = 'Signing in...';
        spinner.classList.remove('hidden');
        errorEl.textContent = '';

        try {
            const success = await api.authenticate(user, pass);

            if (success) {
                // Save token to localStorage
                localStorage.setItem('inventree_token', CONFIG.API_TOKEN);
                this.onAuthSuccess();
            } else {
                errorEl.textContent = 'Invalid username or password';
                btnText.textContent = 'Sign In';
                spinner.classList.add('hidden');
            }
        } catch (e) {
            console.error('Login error:', e);
            errorEl.innerHTML = `Connection Error: ${e.message}<br><small>API: ${CONFIG.API_BASE}</small>`;
            if (window.toast) toast.show(`API Error: ${e.message}`, 'error');
            btnText.textContent = 'Sign In';
            spinner.classList.add('hidden');
        }
    },

    async validateToken() {
        try {
            await api.request('/');
            return true;
        } catch {
            return false;
        }
    },

    async onAuthSuccess() {
        console.log('✓ Authenticated');

        // Hide login modal
        document.getElementById('loginModal').classList.remove('active');
        document.body.classList.remove('not-authenticated');

        // Load data
        await checkConnection();
        await loadLocations();
        await loadParts();

        // Load live wall data
        await wall.loadLiveData();

        // Render catalog
        catalog.render();

        // Initialize Profit Engine (after parts are loaded)
        if (typeof profitEngine !== 'undefined') {
            profitEngine.init();
        }

        // Initialize Tenant Module
        if (typeof tenant !== 'undefined') {
            await tenant.checkSuperAdmin();
            tenant.init();
        }

        // Check low stock
        await alerts.checkLowStock();

        // View restoration is now handled in router.init()

        // Periodic refresh
        setInterval(async () => {
            await checkConnection();
            await loadParts();
            await wall.loadLiveData();
            await alerts.checkLowStock();
        }, CONFIG.REFRESH_INTERVAL);

        toast.show('Welcome back!');
        console.log('✓ Ready');
    },

    logout() {
        localStorage.removeItem('inventree_token');
        CONFIG.API_TOKEN = null;
        location.reload();
    }
};

document.addEventListener('DOMContentLoaded', () => {
    auth.init();
    init();
});
