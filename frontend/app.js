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
    // Zone configuration now loaded dynamically from localStorage
    // Default zones if none configured
    DEFAULT_ZONES: [
        { name: 'A', columns: 4, levels: 7, layoutRow: 0, layoutCol: 0, isActive: true },
        { name: 'B', columns: 4, levels: 7, layoutRow: 0, layoutCol: 1, isActive: true }
    ],
    POWER_SUPPLY_COLUMN: 'B-4'
};

// =============================================================================
// State
// =============================================================================
const state = {
    currentView: 'wall',
    locations: new Map(),
    parts: new Map(),
    zones: [], // Dynamic zone configuration loaded from localStorage
    isConnected: false,
    scanBuffer: '',
    scanTimer: null,
    selectedPart: null,
    // Pagination State
    catalog: {
        results: [],
        next: null,
        count: 0,
        loading: false
    }
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

    async getParts(options = {}) {
        const defaultParams = { limit: 50, offset: 0 };
        const params = { ...defaultParams, ...options };
        const query = buildTenantQuery(params);
        const data = await this.request(`/part/${query}`);
        // If it's a paginated response, it has 'results'. If valid list, it's array.
        // We return the raw data if it has 'results' (to get 'count' & 'next'),
        // OR the array if it's a direct array (rare in InvenTree if limit is used).
        // BUT current app.js expects an ARRAY.
        // We need to support both legacy array return AND new paginated return.
        // For compability during refactor, if 'results' exists, return it properties attached to the array?
        // No, let's return the full object if request asks for it, or just results.
        // Actually, to make 'catalog' pagination work, we MUST return 'next' and 'count'.
        // So we should return the full response object, and let the caller handle .results
        // However, existing code might break if we change return type.
        // Checking usages: 'loadParts' uses .forEach on result.
        // We are removing 'loadParts', so we can change the return signature!
        // BUT 'scanner.handlePart' uses 'api.searchPart', not 'getParts'.
        // Let's standardise: return the full DRF object { count, next, previous, results: [] }
        return data;
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
                    profit: 'Profitability',
                    history: 'Batch History'
                };
                dom.viewTitle.textContent = titles[view] || view;

                // Refresh catalog when navigating to it
                if (view === 'catalog' && state.catalog.results.length === 0) {
                    catalog.reload();
                }

                // Render profitability engine when navigating to it
                if (view === 'profit' && typeof profitEngine !== 'undefined') {
                    profitEngine.render();
                }

                // Initialize history view when navigating to it
                if (view === 'history' && typeof history !== 'undefined') {
                    history.init();
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

        console.log(' Checking saved view:', targetView, 'current:', state.currentView, 'instant:', instant);

        if (targetView !== state.currentView) {
            console.log('Restoring view to:', targetView);

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
                const titles = { wall: 'The Wall', catalog: 'Parts Catalog', profit: 'Profitability', history: 'Batch History' };
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
                        userRole.textContent = 'Staff';
                    } else {
                        userRole.textContent = 'User';
                    }
                }
                if (userAvatar) {
                    userAvatar.textContent = resp.is_superuser ? '' : '';
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
// Zone Configuration Manager
// =============================================================================
const zoneConfig = {
    STORAGE_KEY: 'omiximo_zones',
    TEMPLATES: {
        small: { columns: 3, levels: 5 },
        standard: { columns: 4, levels: 7 },
        large: { columns: 6, levels: 10 }
    },

    init() {
        console.log('zoneConfig.init() called');

        // Migration: Clear incompatible old zone data from pre-Phase 5
        const ZONE_VERSION = '2'; // Phase 5 localStorage format
        const storedVersion = localStorage.getItem('omiximo_zone_version');

        if (storedVersion !== ZONE_VERSION) {
            console.log('Migrating zone config to v2... (clearing old incompatible data)');
            localStorage.removeItem('omiximo_zones');
            localStorage.setItem('omiximo_zone_version', ZONE_VERSION);
            // After migration, force reload of defaults
            state.zones = CONFIG.DEFAULT_ZONES;
            this.save();
            console.log('Migration complete - defaults restored:', state.zones);
            return; // Skip load() since we just set defaults
        }

        this.load();
        console.log(`After load, state.zones =`, state.zones);
        if (state.zones.length === 0) {
            // First time - use defaults
            console.log(' No zones found, loading defaults:', CONFIG.DEFAULT_ZONES);
            state.zones = CONFIG.DEFAULT_ZONES;
            this.save();
        }

        // Fix layout positions: ensure max 2 zones per row
        let needsSave = false;
        state.zones.forEach((zone, index) => {
            const correctRow = Math.floor(index / 2);
            const correctCol = index % 2;
            if (zone.layoutRow !== correctRow || zone.layoutCol !== correctCol) {
                console.log(`Fixing layout for zone ${zone.name}: row ${zone.layoutRow}->${correctRow}, col ${zone.layoutCol}->${correctCol}`);
                zone.layoutRow = correctRow;
                zone.layoutCol = correctCol;
                needsSave = true;
            }
        });
        if (needsSave) {
            this.save();
            console.log('Zone layouts corrected and saved');
        }

        console.log(`Zone Config: Loaded ${state.zones.length} zones`, state.zones);
    },

    load() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                state.zones = JSON.parse(stored);
            }
        } catch (e) {
            console.error('Failed to load zone config:', e);
            state.zones = [];
        }
    },

    save() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state.zones));
            console.log('Zone config saved');
        } catch (e) {
            console.error('Failed to save zone config:', e);
            notifications.show('Failed to save zone configuration', 'error');
        }
    },

    add(zoneData) {
        // Validate zone name is unique
        if (state.zones.find(z => z.name === zoneData.name)) {
            notifications.show(`Zone ${zoneData.name} already exists`, 'error');
            return false;
        }

        state.zones.push({
            name: zoneData.name,
            columns: parseInt(zoneData.columns),
            levels: parseInt(zoneData.levels),
            layoutRow: parseInt(zoneData.layoutRow || 0),
            layoutCol: parseInt(zoneData.layoutCol || state.zones.length),
            isActive: true
        });

        this.save();
        notifications.show(`Zone ${zoneData.name} created`, 'success');
        return true;
    },

    update(zoneName, updates) {
        const zone = state.zones.find(z => z.name === zoneName);
        if (!zone) {
            notifications.show(`Zone ${zoneName} not found`, 'error');
            return false;
        }

        Object.assign(zone, updates);
        this.save();
        notifications.show(`Zone ${zoneName} updated`, 'success');
        return true;
    },

    delete(zoneName) {
        const index = state.zones.findIndex(z => z.name === zoneName);
        if (index === -1) {
            notifications.show(`Zone ${zoneName} not found`, 'error');
            return false;
        }

        state.zones.splice(index, 1);
        this.save();
        notifications.show(`Zone ${zoneName} deleted`, 'success');
        return true;
    },

    getZone(zoneName) {
        return state.zones.find(z => z.name === zoneName);
    },

    getAllZones() {
        return state.zones.filter(z => z.isActive);
    },

    applyTemplate(templateName, targetZone) {
        const template = this.TEMPLATES[templateName];
        if (!template) return false;

        if (targetZone) {
            this.update(targetZone.name, template);
        }
        return template;
    }
};

// =============================================================================
// Zone Manager - UI for Zone Configuration
// =============================================================================
const zoneManager = {
    currentZone: null,

    showAddModal() {
        this.currentZone = null;
        document.getElementById('zoneConfigTitle').textContent = 'Add New Zone';
        document.getElementById('zoneConfigForm').reset();
        document.getElementById('zoneConfigName').disabled = false;

        // Calculate next available zone letter
        const existingZones = state.zones.map(z => z.name).sort();
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let nextZone = 'C'; // Default if A and B exist

        for (let i = 0; i < alphabet.length; i++) {
            if (!existingZones.includes(alphabet[i])) {
                nextZone = alphabet[i];
                break;
            }
        }

        // Pre-fill with suggested zone name
        document.getElementById('zoneConfigName').value = nextZone;
        document.getElementById('zoneConfigName').placeholder = nextZone;

        // Update help text to show existing zones
        const helpText = existingZones.length > 0
            ? `Existing zones: ${existingZones.join(', ')}. Suggested: ${nextZone}`
            : `Single letter (A-Z). Suggested: ${nextZone}`;

        const helpEl = document.querySelector('#zoneConfigName + .form-help');
        if (helpEl) helpEl.textContent = helpText;

        document.getElementById('zoneConfigModal').classList.add('active');
    },

    configureZone(zoneName) {
        const zone = zoneConfig.getZone(zoneName);
        if (!zone) return;

        this.currentZone = zone;
        document.getElementById('zoneConfigTitle').textContent = `Configure Zone ${zoneName}`;
        document.getElementById('zoneConfigName').value = zone.name;
        document.getElementById('zoneConfigName').disabled = true; // Can't change zone name
        document.getElementById('zoneConfigColumns').value = zone.columns;
        document.getElementById('zoneConfigLevels').value = zone.levels;

        // Reset help text for editing mode
        const helpEl = document.querySelector('#zoneConfigName + .form-help');
        if (helpEl) helpEl.textContent = 'Zone name cannot be changed';

        document.getElementById('zoneConfigModal').classList.add('active');
    },

    closeConfigModal() {
        document.getElementById('zoneConfigModal').classList.remove('active');
        this.currentZone = null;
    },

    applyTemplate(templateName) {
        const template = zoneConfig.TEMPLATES[templateName];
        if (!template) return;

        document.getElementById('zoneConfigColumns').value = template.columns;
        document.getElementById('zoneConfigLevels').value = template.levels;
    },

    async submitConfig(e) {
        e.preventDefault();

        const name = document.getElementById('zoneConfigName').value.trim().toUpperCase();
        const columns = parseInt(document.getElementById('zoneConfigColumns').value);
        const levels = parseInt(document.getElementById('zoneConfigLevels').value);

        // Validation
        if (!/^[A-Z]$/.test(name)) {
            notifications.show('Zone name must be a single letter (A-Z)', 'error');
            return;
        }

        if (columns < 1 || columns > 10) {
            notifications.show('Columns must be between 1 and 10', 'error');
            return;
        }

        if (levels < 1 || levels > 15) {
            notifications.show('Levels must be between 1 and 15', 'error');
            return;
        }

        // Add or update zone
        let success;
        if (this.currentZone) {
            // Update existing zone
            success = zoneConfig.update(this.currentZone.name, { columns, levels });
        } else {
            // Add new zone
            // Calculate layout position: max 2 zones per row
            const zoneIndex = state.zones.length;
            const layoutRow = Math.floor(zoneIndex / 2);  // 0-1 in row 0, 2-3 in row 1, etc.
            const layoutCol = zoneIndex % 2;              // Alternates 0, 1, 0, 1...

            success = zoneConfig.add({
                name,
                columns,
                levels,
                layoutRow,
                layoutCol
            });
        }

        if (success) {
            this.closeConfigModal();
            wall.render();
            wall.loadLiveData(); // Reload stock data for new cells
        }
    },

    confirmDelete(zoneName) {
        const zone = zoneConfig.getZone(zoneName);
        if (!zone) return;

        this.currentZone = zone;
        const cellCount = zone.columns * zone.levels;

        document.getElementById('deleteZoneName').textContent = zoneName;
        document.getElementById('deleteZoneNameRepeat').textContent = zoneName;
        document.getElementById('deleteZoneCellCount').textContent = cellCount;
        document.getElementById('deleteZoneConfirmWipe').checked = false;
        document.getElementById('deleteZoneBtn').disabled = true;

        document.getElementById('zoneDeleteModal').classList.add('active');
    },

    closeDeleteModal() {
        document.getElementById('zoneDeleteModal').classList.remove('active');
        this.currentZone = null;
    },

    onConfirmCheckChange(checked) {
        document.getElementById('deleteZoneBtn').disabled = !checked;
    },

    async executeDelete() {
        if (!this.currentZone) return;

        const success = zoneConfig.delete(this.currentZone.name);
        if (success) {
            this.closeDeleteModal();
            wall.render();
        }
    }
};

// =============================================================================
// Shelf Configuration - Per-Shelf Settings for Bin A/B FIFO Logic
// =============================================================================
const shelfConfig = {
    STORAGE_KEY: 'omiximo_shelf_config',
    config: {},

    init() {
        console.log('shelfConfig.init() called');
        this.load();
        console.log(`Shelf Config: Loaded ${Object.keys(this.config).length} shelf configurations`);
    },

    load() {
        try {
            const stored = localStorage.getItem(this.STORAGE_KEY);
            if (stored) {
                this.config = JSON.parse(stored);
            }
        } catch (e) {
            console.error('Failed to load shelf config:', e);
            this.config = {};
        }
    },

    save() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.config));
            console.log('Shelf config saved');
        } catch (e) {
            console.error('Failed to save shelf config:', e);
        }
    },

    /**
     * Extract shelf ID from cell ID (removes bin suffix)
     * 'A-1-3-A' → 'A-1-3'
     * 'B-4-7' → 'B-4-7' (already a shelf ID for single bin shelves)
     */
    getShelfId(cellId) {
        const parts = cellId.split('-');
        // Cell IDs have 4 parts: Zone-Col-Level-Bin (e.g., A-1-3-A)
        // Shelf IDs have 3 parts: Zone-Col-Level (e.g., A-1-3)
        if (parts.length === 4) {
            return parts.slice(0, 3).join('-');
        }
        return cellId; // Already a shelf ID
    },

    /**
     * Get configuration for a specific shelf
     */
    getShelfConfig(shelfId) {
        return this.config[shelfId] || {
            splitFifo: false,      // When true: A & B hold different products, no auto-transfer
            splitBins: false,       // When true: No A/B division, single bin for entire shelf
            capacities: {}          // Per-product capacities: { partId: { binA: qty, binB: qty } }
        };
    },

    /**
     * Update configuration for a specific shelf
     */
    setShelfConfig(shelfId, updates) {
        if (!this.config[shelfId]) {
            this.config[shelfId] = {
                splitFifo: false,
                splitBins: false,
                capacities: {}
            };
        }
        Object.assign(this.config[shelfId], updates);
        this.save();
    },

    /**
     * Get bin capacity for a specific part in a specific bin
     * @returns {number|null} Capacity or null if not defined
     */
    getBinCapacity(shelfId, partId, binLetter) {
        const config = this.getShelfConfig(shelfId);
        const partCaps = config.capacities[partId];
        if (!partCaps) return null; // Not defined yet
        return binLetter === 'A' ? partCaps.binA : partCaps.binB;
    },

    /**
     * Set bin capacity for a specific part (called on first receive)
     */
    setBinCapacity(shelfId, partId, capacity) {
        const config = this.getShelfConfig(shelfId);
        if (!config.capacities[partId]) {
            config.capacities[partId] = { binA: null, binB: null };
        }
        // Set same capacity for both bins
        config.capacities[partId].binA = capacity;
        config.capacities[partId].binB = capacity;
        this.setShelfConfig(shelfId, { capacities: config.capacities });
        console.log(`Set capacity for part ${partId} in ${shelfId}: ${capacity === null ? 'unlimited (FIFO batch-by-batch)' : capacity + ' per bin'}`);
    },

    /**
     * Check if shelf has Split FIFO mode enabled
     */
    isSplitFifo(shelfId) {
        return this.getShelfConfig(shelfId).splitFifo;
    },

    /**
     * Check if shelf has Single Bin mode (no A/B separation)
     */
    isSplitBins(shelfId) {
        return this.getShelfConfig(shelfId).splitBins;
    },

    /**
     * Toggle Split FIFO mode for a shelf
     */
    toggleSplitFifo(shelfId, enabled) {
        this.setShelfConfig(shelfId, { splitFifo: enabled });
        console.log(`Split FIFO ${enabled ? 'enabled' : 'disabled'} for ${shelfId}`);
    },

    /**
     * Toggle Single Bin mode for a shelf
     */
    toggleSplitBins(shelfId, enabled) {
        this.setShelfConfig(shelfId, { splitBins: enabled });
        console.log(`Single Bin mode ${enabled ? 'enabled' : 'disabled'} for ${shelfId}`);
    },

    /**
     * Get all unique shelves from locations
     */
    getAllShelves() {
        const shelves = new Set();
        for (const [name] of state.locations) {
            const shelfId = this.getShelfId(name);
            if (shelfId && shelfId.split('-').length >= 3) {
                shelves.add(shelfId);
            }
        }
        return [...shelves].sort();
    }
};

// =============================================================================
// Bin Info Modal - Shows bin details and per-shelf configuration
// =============================================================================
const binInfoModal = {
    currentShelfId: null,
    currentBinLetter: null,
    currentStock: [],

    init() {
        const modal = document.getElementById('binInfoModal');
        const closeBtn = document.getElementById('binInfoClose');

        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.close();
            });
        }

        // Toggle event listeners
        const splitFifoCheckbox = document.getElementById('binConfigSplitFifo');
        const splitBinsCheckbox = document.getElementById('binConfigSplitBins');

        if (splitFifoCheckbox) {
            splitFifoCheckbox.addEventListener('change', (e) => this.onSplitFifoChange(e.target.checked));
        }
        if (splitBinsCheckbox) {
            splitBinsCheckbox.addEventListener('change', (e) => this.onSplitBinsChange(e.target.checked));
        }
    },

    async show(cellId) {
        console.log(` Opening bin info for: ${cellId}`);

        this.currentShelfId = shelfConfig.getShelfId(cellId);
        this.currentBinLetter = cellId.endsWith('-A') ? 'A' : cellId.endsWith('-B') ? 'B' : null;

        const config = shelfConfig.getShelfConfig(this.currentShelfId);

        // Parse cell ID components (e.g., "A-1-3-A" → zone=A, col=1, level=3, bin=A)
        const idParts = cellId.split('-');
        const zone = idParts[0] || '?';
        const col = idParts[1] || '?';
        const level = idParts[2] || '?';
        const binLetter = idParts[3] || '';

        // Update bin badge
        const badgeZone = document.querySelector('.bin-badge-zone');
        const badgeLocation = document.querySelector('.bin-badge-location');
        const badgeBin = document.querySelector('.bin-badge-bin');
        if (badgeZone) badgeZone.textContent = zone;
        if (badgeLocation) badgeLocation.textContent = `${col}-${level}`;
        if (badgeBin) {
            badgeBin.textContent = binLetter ? `Bin ${binLetter}` : 'Shelf';
            badgeBin.style.display = binLetter ? 'block' : 'none';
        }

        // Set modal title and subtitle
        document.getElementById('binInfoTitle').textContent = `Bin ${cellId}`;
        document.getElementById('binInfoShelfId').textContent = `Zone ${zone} · Column ${col} · Level ${level}`;

        // Get location ID for this cell
        let location = state.locations.get(cellId);

        // For single bin mode on regular shelves, the location might not exist directly
        // (e.g., "A-1-3" doesn't exist, only "A-1-3-A" and "A-1-3-B" do)
        // In this case, we need to combine stock from both A and B bins
        const isSingleBinMode = !this.currentBinLetter && shelfConfig.isSplitBins(this.currentShelfId);

        // Load stock for this cell
        try {
            if (location) {
                // Direct location found (power supply or native single bin)
                this.currentStock = await api.getStockAtLocation(location.pk);
            } else if (isSingleBinMode) {
                // Single bin mode on regular shelf - combine stock from A and B
                const locA = state.locations.get(`${cellId}-A`);
                const locB = state.locations.get(`${cellId}-B`);

                const stockA = locA ? await api.getStockAtLocation(locA.pk) : [];
                const stockB = locB ? await api.getStockAtLocation(locB.pk) : [];

                this.currentStock = [...stockA, ...stockB];
                console.log(`Single bin mode: Combined ${stockA.length} + ${stockB.length} batches`);
            } else {
                console.warn(`Location not found for cell: ${cellId}`);
                document.getElementById('binProductSection').style.display = 'none';
                document.getElementById('binEmptySection').style.display = 'flex';
                document.getElementById('binInfoModal').classList.add('active');
                return;
            }
        } catch (e) {
            console.error('Failed to load stock:', e);
            this.currentStock = [];
        }

        // Display stock info
        if (this.currentStock.length === 0) {
            document.getElementById('binProductSection').style.display = 'none';
            document.getElementById('binEmptySection').style.display = 'flex';
        } else {
            document.getElementById('binEmptySection').style.display = 'none';
            document.getElementById('binProductSection').style.display = 'flex';

            // Get first stock item (could be multiple batches of same product)
            const firstStock = this.currentStock[0];
            const part = state.parts.get(firstStock.part);
            const totalQty = this.currentStock.reduce((sum, s) => sum + s.quantity, 0);
            const totalValue = this.currentStock.reduce((sum, s) => sum + (s.quantity * (s.purchase_price || 0)), 0);
            const capacity = shelfConfig.getBinCapacity(this.currentShelfId, firstStock.part, this.currentBinLetter);

            // Update product name
            document.getElementById('binProductName').textContent = part?.name || 'Unknown Part';

            // Update stock metrics (separate elements)
            document.getElementById('binProductQty').textContent = totalQty;
            document.getElementById('binProductCapacity').textContent = capacity || '∞';

            // Update progress bar
            const fillEl = document.getElementById('binStockFill');
            if (fillEl && capacity) {
                const fillPercent = Math.min((totalQty / capacity) * 100, 100);
                fillEl.style.width = `${fillPercent}%`;
                if (fillPercent < 20) {
                    fillEl.classList.add('low');
                } else {
                    fillEl.classList.remove('low');
                }
            } else if (fillEl) {
                fillEl.style.width = '100%';
                fillEl.classList.remove('low');
            }

            // Update value
            document.getElementById('binProductValue').textContent = `€${totalValue.toFixed(2)} total value`;
        }

        // Set toggle states
        document.getElementById('binConfigSplitFifo').checked = config.splitFifo || false;
        document.getElementById('binConfigSplitBins').checked = config.splitBins || false;

        // Show modal
        document.getElementById('binInfoModal').classList.add('active');
    },

    close() {
        document.getElementById('binInfoModal').classList.remove('active');
        this.currentShelfId = null;
        this.currentBinLetter = null;
        this.currentStock = [];
    },

    onSplitFifoChange(enabled) {
        if (!this.currentShelfId) return;
        shelfConfig.toggleSplitFifo(this.currentShelfId, enabled);
        notifications.show(
            enabled
                ? 'Split FIFO enabled - Bins A and B are now independent'
                : 'Split FIFO disabled - Normal FIFO rotation restored',
            'info'
        );
    },

    onSplitBinsChange(enabled) {
        if (!this.currentShelfId) return;
        shelfConfig.toggleSplitBins(this.currentShelfId, enabled);

        // Re-render the cell to update visual appearance
        wall.rerenderCell(this.currentShelfId);

        // Close modal since the cell structure changed
        this.close();

        notifications.show(
            enabled
                ? 'Single Bin mode enabled - Cell merged'
                : 'A/B separation restored - Cell split',
            'success'
        );
    },

    async viewBatches() {
        if (this.currentStock.length === 0) {
            toast.show('No batches in this bin', 'info');
            return;
        }
        // Open first batch in batch detail modal
        if (typeof batchDetail !== 'undefined') {
            batchDetail.show(this.currentStock[0].pk);
            this.close();
        }
    },

    async editCapacity() {
        if (this.currentStock.length === 0) {
            toast.show('Add stock first to set capacity', 'info');
            return;
        }

        const partId = this.currentStock[0].part;
        const currentCapacity = shelfConfig.getBinCapacity(this.currentShelfId, partId, this.currentBinLetter);

        const newCapacity = prompt(
            `Enter bin capacity for this product:\n(Current: ${currentCapacity || 'not set'})\n\nLeave empty or enter 0 to remove capacity limit.\nWhen not set, batches are retrieved one-by-one (FIFO order).`,
            currentCapacity || ''
        );

        if (newCapacity === null) {
            // User cancelled
            return;
        }

        const parsedCapacity = parseInt(newCapacity);

        if (newCapacity === '' || parsedCapacity === 0) {
            // Clear capacity - make it unlimited
            shelfConfig.setBinCapacity(this.currentShelfId, partId, null);
            toast.show('Capacity limit removed (unlimited)', 'success');
            document.getElementById('binProductCapacity').textContent = '∞';
            // Update progress bar to hide when unlimited
            const fillEl = document.getElementById('binStockFill');
            if (fillEl) fillEl.style.width = '0%';
        } else if (!isNaN(parsedCapacity) && parsedCapacity > 0) {
            shelfConfig.setBinCapacity(this.currentShelfId, partId, parsedCapacity);
            toast.show(`Capacity set to ${parsedCapacity} units`, 'success');
            document.getElementById('binProductCapacity').textContent = parsedCapacity;
        } else {
            toast.show('Invalid capacity value', 'error');
        }
    }
};

// =============================================================================
// Wall Grid Renderer
// =============================================================================
const wall = {
    init() {
        this.render();
    },

    render() {
        console.log('Wall.render() called');
        dom.wallGrid.innerHTML = '';
        const activeZones = zoneConfig.getAllZones();
        console.log('Active zones:', activeZones);

        if (activeZones.length === 0) {
            console.log('No zones configured, showing empty state');
            dom.wallGrid.innerHTML = '<div class="empty-state">No zones configured. Click "Add Zone" to get started.</div>';
            this.renderAddZoneButton();
            return;
        }

        // Group zones by layout row for hybrid layout support
        const zonesByRow = this.groupZonesByRow(activeZones);
        console.log('Zones by row:', zonesByRow);

        // Render each row of zones
        Object.keys(zonesByRow).sort().forEach(rowKey => {
            const rowZones = zonesByRow[rowKey];
            const wallRow = document.createElement('div');
            wallRow.className = 'wall-row';
            wallRow.style.gridTemplateColumns = `repeat(${rowZones.length}, 1fr)`;
            wallRow.style.gap = '2rem';

            // Render each zone in this row
            rowZones.forEach(zone => {
                console.log(`Rendering zone ${zone.name}`);
                const zoneContainer = this.renderZone(zone);
                wallRow.appendChild(zoneContainer);
            });

            dom.wallGrid.appendChild(wallRow);
        });

        // Add "Add Zone" button
        console.log('➕ Adding "Add Zone" button');
        this.renderAddZoneButton();
        console.log('Wall.render() complete');
    },

    groupZonesByRow(zones) {
        const grouped = {};
        zones.forEach(zone => {
            const rowKey = zone.layoutRow || 0;
            if (!grouped[rowKey]) grouped[rowKey] = [];
            grouped[rowKey].push(zone);
        });
        // Sort zones within each row by layoutCol
        Object.keys(grouped).forEach(key => {
            grouped[key].sort((a, b) => (a.layoutCol || 0) - (b.layoutCol || 0));
        });
        return grouped;
    },

    renderZone(zone) {
        const zoneContainer = document.createElement('div');
        zoneContainer.className = 'zone-container';
        zoneContainer.dataset.zoneName = zone.name;

        // Zone header
        const header = document.createElement('div');
        header.className = 'zone-header';
        header.innerHTML = `
            <div class="zone-badge">ZONE ${zone.name}</div>
            <div class="zone-info">${zone.columns} cols × ${zone.levels} levels</div>
            <div class="zone-actions">
                <button class="zone-action-btn" onclick="zoneManager.configureZone('${zone.name}')" title="Configure Zone"></button>
                <button class="zone-action-btn zone-delete-btn" onclick="zoneManager.confirmDelete('${zone.name}')" title="Delete Zone"></button>
            </div>
        `;
        zoneContainer.appendChild(header);

        // Column headers
        const colHeaders = document.createElement('div');
        colHeaders.className = 'column-headers';
        colHeaders.style.gridTemplateColumns = `40px repeat(${zone.columns}, 1fr)`;
        colHeaders.innerHTML = `<div class="column-header"></div>`;
        for (let col = 1; col <= zone.columns; col++) {
            const colHeader = document.createElement('div');
            colHeader.className = 'column-header';
            colHeader.textContent = `${zone.name}-${col}`;
            colHeaders.appendChild(colHeader);
        }
        zoneContainer.appendChild(colHeaders);

        // Grid (levels from top to bottom)
        const grid = document.createElement('div');
        grid.className = 'zone-grid';

        for (let level = zone.levels; level >= 1; level--) {
            const row = document.createElement('div');
            row.className = 'grid-row';
            row.style.gridTemplateColumns = `40px repeat(${zone.columns}, 1fr)`;

            // Row label
            const label = document.createElement('div');
            label.className = 'row-label';
            label.textContent = `L${level}`;
            row.appendChild(label);

            // Cells for this row
            for (let col = 1; col <= zone.columns; col++) {
                const cellId = `${zone.name}-${col}-${level}`;
                const isPowerSupply = `${zone.name}-${col}` === CONFIG.POWER_SUPPLY_COLUMN;
                row.appendChild(this.createCell(cellId, isPowerSupply));
            }

            grid.appendChild(row);
        }

        zoneContainer.appendChild(grid);
        return zoneContainer;
    },

    renderAddZoneButton() {
        console.log('renderAddZoneButton() called');
        const addRow = document.createElement('div');
        addRow.className = 'wall-add-zone-row';
        addRow.innerHTML = `
            <button class="btn-add-zone" onclick="zoneManager.showAddModal()">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Add New Zone
            </button>
        `;
        dom.wallGrid.appendChild(addRow);
        console.log('Add Zone button appended to DOM');
    },

    createCell(cellId, isPowerSupply) {
        const cell = document.createElement('div');
        cell.className = 'cell empty';
        cell.dataset.cellId = cellId;

        // Check if this shelf is configured as Single Bin mode (via toggle)
        const isSingleBin = isPowerSupply || shelfConfig.isSplitBins(cellId);

        if (isSingleBin) {
            cell.classList.add('solid');
            // Single bin mode - no A/B division
            const bin = document.createElement('div');
            bin.className = 'bin-half';
            bin.innerHTML = '<span class="qty">-</span>';
            bin.addEventListener('click', (e) => {
                e.stopPropagation();
                binInfoModal.show(`${cellId}`);  // No -A/-B suffix for solid bins
            });
            cell.appendChild(bin);
        } else {
            // Split bins for standard cells
            const binA = document.createElement('div');
            binA.className = 'bin-half bin-a';
            binA.innerHTML = '<span class="label">A</span><span class="qty">-</span>';
            binA.addEventListener('click', (e) => {
                e.stopPropagation();
                binInfoModal.show(`${cellId}-A`);
            });

            const binB = document.createElement('div');
            binB.className = 'bin-half bin-b';
            binB.innerHTML = '<span class="label">B</span><span class="qty">-</span>';
            binB.addEventListener('click', (e) => {
                e.stopPropagation();
                binInfoModal.show(`${cellId}-B`);
            });

            cell.appendChild(binA);
            cell.appendChild(binB);
        }

        cell.addEventListener('click', () => this.showCellDetails(cellId, isSingleBin));

        return cell;
    },

    /**
     * Re-render a specific cell (used when configuration changes)
     */
    rerenderCell(cellId) {
        const existingCell = document.querySelector(`[data-cell-id="${cellId}"]`);
        if (!existingCell) {
            console.warn(`Cell not found for re-render: ${cellId}`);
            return;
        }

        // Determine if it's a power supply column
        const parts = cellId.split('-');
        const isPowerSupply = `${parts[0]}-${parts[1]}` === CONFIG.POWER_SUPPLY_COLUMN;

        // Create new cell with updated configuration
        const newCell = this.createCell(cellId, isPowerSupply);

        // Copy over any status classes (like 'stocked', 'low', etc.)
        if (existingCell.classList.contains('stocked')) newCell.classList.add('stocked');
        if (existingCell.classList.contains('low')) newCell.classList.add('low');
        if (existingCell.classList.contains('loading')) newCell.classList.add('loading');

        // Replace the old cell with the new one
        existingCell.parentNode.replaceChild(newCell, existingCell);

        // Reload data for this cell
        this.loadCellData(cellId, isPowerSupply || shelfConfig.isSplitBins(cellId));

        console.log(`Cell ${cellId} re-rendered`);
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
                <div class="stock-item ${hasAllocation ? 'has-allocation' : ''}" onclick="batchDetail.show(${item.pk})" style="cursor: pointer;">
                    <div class="stock-item-name">${item.part_detail?.name || 'Unknown'}</div>
                    <div class="stock-item-meta">
                        <span class="stock-qty ${hasAllocation ? 'partial' : ''}">${available}/${qty}</span>
                        <span class="stock-price">€${(item.purchase_price || 0).toFixed(2)}</span>
                        ${hasAllocation ? `<span class="allocation-badge" title="${allocated} reserved"></span>` : ''}
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
        console.log('Loading live wall data (parallel)...');
        const startTime = performance.now();

        // Get active zones from dynamic configuration
        const activeZones = zoneConfig.getAllZones();

        if (activeZones.length === 0) {
            console.warn('No active zones configured, skipping data load');
            return;
        }

        // Collect all cell IDs with their metadata
        const cellsToLoad = [];
        for (let zone of activeZones) {
            for (let col = 1; col <= zone.columns; col++) {
                for (let level = 1; level <= zone.levels; level++) {
                    const cellId = `${zone.name}-${col}-${level}`;
                    const isPowerSupply = `${zone.name}-${col}` === CONFIG.POWER_SUPPLY_COLUMN;
                    cellsToLoad.push({ cellId, isPowerSupply });

                    // Add loading state to cell (skeleton UI)
                    const cell = document.querySelector(`[data-cell-id="${cellId}"]`);
                    if (cell) cell.classList.add('loading');
                }
            }
        }

        // Load all cells in parallel using Promise.all
        const loadPromises = cellsToLoad.map(({ cellId, isPowerSupply }) =>
            this.loadCellData(cellId, isPowerSupply)
                .catch(e => {
                    console.warn(`Failed to load ${cellId}:`, e);
                    return null; // Return null so Promise.all doesn't fail
                })
                .finally(() => {
                    // Remove loading state when done
                    const cell = document.querySelector(`[data-cell-id="${cellId}"]`);
                    if (cell) cell.classList.remove('loading');
                })
        );

        // Wait for all cells to load
        await Promise.all(loadPromises);

        const endTime = performance.now();
        const loadTime = ((endTime - startTime) / 1000).toFixed(2);
        console.log(`Wall data loaded in ${loadTime}s (${cellsToLoad.length} cells)`);
    },

    /**
     * Load data for a single cell and update its status
     */
    async loadCellData(cellId, isPowerSupply) {
        let totalQty = 0;
        let qtyA = 0;
        let qtyB = 0;
        let qtyBase = 0;

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
            const locBase = state.locations.get(cellId);

            // Use a Set to track stock IDs and prevent double-counting
            const seenStockIds = new Set();

            if (locA) {
                const stockA = await api.getStockAtLocation(locA.pk);
                for (const item of stockA) {
                    if (!seenStockIds.has(item.pk)) {
                        seenStockIds.add(item.pk);
                        qtyA += item.quantity || 0;
                    }
                }
            }

            if (locB) {
                const stockB = await api.getStockAtLocation(locB.pk);
                for (const item of stockB) {
                    if (!seenStockIds.has(item.pk)) {
                        seenStockIds.add(item.pk);
                        qtyB += item.quantity || 0;
                    }
                }
            }

            // Also check base shelf location (stock may exist directly at shelf without A/B suffix)
            if (locBase) {
                const stockBase = await api.getStockAtLocation(locBase.pk);
                for (const item of stockBase) {
                    if (!seenStockIds.has(item.pk)) {
                        seenStockIds.add(item.pk);
                        qtyBase += item.quantity || 0;
                    }
                }
            }

            totalQty = qtyA + qtyB + qtyBase;
            // Add base qty to A for display purposes (newer stock)
            this.updateCellStatus(cellId, this.getStatus(totalQty), qtyA + qtyBase, qtyB);
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
                console.log(`FIFO rotation: Receiving to ${locName} (Bin A)`);

                // Find corresponding Bin B
                const binBName = locName.slice(0, -1) + 'B'; // Replace -A with -B
                const binBLocation = [...state.locations.entries()].find(([name]) => name === binBName);

                if (binBLocation) {
                    const binBId = binBLocation[1].pk;

                    // Check for existing stock in Bin A for this part
                    const existingStockA = await api.getStockAtLocation(locationId);
                    const partStockInA = existingStockA.filter(item => item.part === partId);

                    if (partStockInA.length > 0) {
                        console.log(`  Found ${partStockInA.length} existing batch(es) in Bin A, moving to Bin B...`);

                        // Move all existing Bin A stock to Bin B
                        for (const stockItem of partStockInA) {
                            await this.moveStock(stockItem.pk, binBId, stockItem.quantity);
                            console.log(`  Moved ${stockItem.quantity} units (€${stockItem.purchase_price}) to ${binBName}`);
                        }

                        toast.show(`Rotated old batch to Bin B`, 'info');
                    } else {
                        console.log(`  No existing stock in Bin A, direct placement`);
                    }
                } else {
                    console.warn(`  Bin B not found for rotation (${binBName})`);
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

                console.log('FIFO Picking Order:', sortedStock.map(s => `${s.location_detail?.name} (${s.quantity} @ €${s.purchase_price})`));

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

                    console.log(`  Consumed ${toConsume} from ${item.location_detail?.name} @ €${item.purchase_price}`);
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
// Category Manager (Create categories on demand)
// =============================================================================
const categoryManager = {
    init() {
        const modal = document.getElementById('categoryModal');
        const closeBtn = document.getElementById('categoryModalClose');
        const cancelBtn = document.getElementById('categoryCancel');
        const form = document.getElementById('categoryForm');

        if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.hide());
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.hide();
            });
        }
        if (form) form.addEventListener('submit', (e) => this.submit(e));
    },

    show() {
        const modal = document.getElementById('categoryModal');
        document.getElementById('categoryName').value = '';
        document.getElementById('categoryDescription').value = '';
        modal.classList.add('active');
        document.getElementById('categoryName').focus();
    },

    hide() {
        document.getElementById('categoryModal').classList.remove('active');
    },

    async submit(e) {
        e.preventDefault();

        const name = document.getElementById('categoryName').value.trim();
        const description = document.getElementById('categoryDescription').value.trim();

        if (!name) {
            toast.show('Please enter a category name', 'error');
            return;
        }

        try {
            await api.createCategory({ name, description });
            toast.show(`Category "${name}" created!`, 'success');
            this.hide();

            // Refresh the category filter dropdown
            await catalog.loadCategories();

            // Also refresh the part modal's category dropdown if it exists
            const partCatSelect = document.getElementById('partCategory');
            if (partCatSelect) {
                partCatSelect.innerHTML = '<option value="">No Category</option>';
                catalog.categories.forEach(cat => {
                    const opt = document.createElement('option');
                    opt.value = cat.pk;
                    opt.textContent = cat.name;
                    partCatSelect.appendChild(opt);
                });
            }
        } catch (err) {
            console.error('Create category error:', err);
            toast.show('Failed to create category', 'error');
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
        // Search input (Server-side Debounce)
        if (dom.catalogSearch) {
            dom.catalogSearch.addEventListener('input', (e) => {
                clearTimeout(this.searchDebounce);
                this.searchDebounce = setTimeout(() => {
                    this.reload();
                }, 400); // 400ms debounce
            });
        }

        // Category filter
        const categoryFilter = document.getElementById('catalogCategoryFilter');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                this.filterCategory = e.target.value;
                this.reload();
            });
        }

        // FAB button
        const addBtn = document.getElementById('btnAddPart');
        if (addBtn) {
            addBtn.addEventListener('click', () => partManager.showCreate());
        }

        // New Category button
        const newCatBtn = document.getElementById('btnNewCategory');
        if (newCatBtn) {
            newCatBtn.addEventListener('click', () => categoryManager.show());
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

    /**
     * Clear and reload catalog
     */
    async reload() {
        state.catalog.results = [];
        state.catalog.next = null;
        state.catalog.count = 0;
        await this.loadNextPage();
    },

    /**
     * Load next page of parts
     */
    async loadNextPage() {
        if (state.catalog.loading) return;
        state.catalog.loading = true;

        const grid = document.getElementById('catalogGrid');

        // Show loading indicator if appending
        let loadingIndicator = null;
        if (state.catalog.results.length > 0 && grid) {
            loadingIndicator = document.createElement('div');
            loadingIndicator.className = 'catalog-loading-more';
            loadingIndicator.innerHTML = '<div class="spinner"></div> Loading more...';
            grid.appendChild(loadingIndicator);
        } else if (grid) {
            grid.innerHTML = '<div class="catalog-loading">Loading parts...</div>';
        }

        try {
            const params = {
                limit: 24, // Optimized for 3/4 column grid
                offset: state.catalog.results.length
            };

            // Search query
            const search = dom.catalogSearch?.value?.trim();
            if (search) params.search = search;

            // Category filter
            if (this.filterCategory) params.category = this.filterCategory;

            const data = await api.getParts(params);

            // Handle response (DRF paginated object)
            const newParts = data.results || [];

            // Update state
            state.catalog.count = data.count || 0;
            state.catalog.next = data.next;
            state.catalog.results = [...state.catalog.results, ...newParts];

            // Update parts cache for other lookups
            newParts.forEach(p => state.parts.set(p.pk, p));

            this.render();

        } catch (e) {
            console.error('Failed to load parts:', e);
            if (grid && state.catalog.results.length === 0) {
                grid.innerHTML = '<div class="catalog-error">Failed to load catalog</div>';
            }
        } finally {
            state.catalog.loading = false;
            // Remove loading indicator
            if (loadingIndicator) loadingIndicator.remove();
        }
    },

    render() {
        if (!dom.catalogGrid) return;

        const parts = state.catalog.results;
        const searchQuery = dom.catalogSearch?.value?.trim();

        if (parts.length === 0) {
            dom.catalogGrid.innerHTML = `
                <div class="catalog-empty">
                    <span>${searchQuery ? '' : ''}</span>
                    <p>${searchQuery ? `No parts found matching "${searchQuery}"` : 'No parts found.'}</p>
                </div>
            `;
            return;
        }

        dom.catalogGrid.innerHTML = parts.map(p => this.createCard(p)).join('');

        // Append "Load More" button if there are more results
        if (state.catalog.next) {
            const loadMoreBtn = document.createElement('button');
            loadMoreBtn.className = 'btn-load-more';
            loadMoreBtn.innerHTML = 'Load More';
            loadMoreBtn.onclick = () => this.loadNextPage();

            const btnContainer = document.createElement('div');
            btnContainer.className = 'load-more-container';
            btnContainer.appendChild(loadMoreBtn);
            dom.catalogGrid.appendChild(btnContainer);
        }

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
                    <div class="batch-item" data-stock-id="${stock.pk}" onclick="batchDetail.show(${stock.pk})" style="cursor: pointer;">
                        <div class="batch-label">Batch ${batchLabel}</div>
                        <div class="batch-location">${location}</div>
                        <div class="batch-details">
                            <span class="batch-qty">${qty} units</span>
                            <span class="batch-price">€${parseFloat(price).toFixed(2)}</span>
                        </div>
                        <button class="batch-edit-btn" data-stock-id="${stock.pk}" title="Edit Batch" onclick="event.stopPropagation(); batchEditor.showById(${stock.pk})">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                            </svg>
                        </button>
                    </div>
                `;
            }).join('');

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
    },

    /**
     * Scroll to a specific part in the catalog
     */
    scrollToPart(partPk) {
        const partCard = document.querySelector(`[data-part-id="${partPk}"]`);
        if (partCard) {
            partCard.closest('.part-card').scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
            // Optional: highlight the card briefly
            const card = partCard.closest('.part-card');
            card.style.transition = 'background 0.3s';
            card.style.background = 'var(--accent-glow)';
            setTimeout(() => {
                card.style.background = '';
            }, 1000);
        }
    }
};

// =============================================================================
// Batch Detail Modal
// =============================================================================
const batchDetail = {
    currentStock: null,

    async show(stockId) {
        try {
            // Fetch full stock details with nested part and location info
            const stock = await api.request(`/stock/${stockId}/?part_detail=true&location_detail=true`);
            this.currentStock = stock;
            console.log('batchDetail loaded stock:', stock);

            // Get part details
            const part = state.parts.get(stock.part) || await api.request(`/part/${stock.part}/`);

            // Populate modal
            document.getElementById('batchDetailPartName').textContent = part.name || 'Unknown';
            document.getElementById('batchDetailSKU').textContent = part.IPN || `PK-${stock.part}`;
            document.getElementById('batchDetailLocation').textContent =
                stock.location_detail?.name || 'Unknown';
            document.getElementById('batchDetailQty').textContent = stock.quantity;
            document.getElementById('batchDetailAllocated').textContent = stock.allocated || 0;
            document.getElementById('batchDetailUnitCost').textContent =
                `€${parseFloat(stock.purchase_price || 0).toFixed(2)}`;
            document.getElementById('batchDetailTotalValue').textContent =
                `€${(stock.quantity * (stock.purchase_price || 0)).toFixed(2)}`;
            document.getElementById('batchDetailReceived').textContent =
                this.formatDate(stock.stocktake_date);
            document.getElementById('batchDetailBatchCode').textContent =
                stock.batch || 'N/A';

            // Parse supplier URL from notes
            const supplierURL = this.extractSupplierURL(stock.notes);
            const urlContainer = document.getElementById('batchDetailSupplierURL');

            if (supplierURL) {
                urlContainer.innerHTML = `
                    <a href="${supplierURL}" target="_blank" rel="noopener noreferrer" class="supplier-link">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                        <span class="supplier-link-text">${this.shortenURL(supplierURL)}</span>
                    </a>
                `;
            } else {
                urlContainer.innerHTML = '<span class="detail-empty">No supplier URL provided</span>';
            }

            // Show/hide notes section
            const notesSection = document.getElementById('batchDetailNotesSection');
            const notesEl = document.getElementById('batchDetailNotes');

            // Only show notes if they exist and are different from just the URL
            const cleanNotes = stock.notes ? stock.notes.replace(supplierURL || '', '').trim() : '';
            if (cleanNotes) {
                notesSection.style.display = 'block';
                notesEl.textContent = cleanNotes;
            } else {
                notesSection.style.display = 'none';
            }

            // Show modal
            document.getElementById('batchDetailModal').classList.add('active');
        } catch (e) {
            console.error('Failed to load batch details:', e);
            notifications.show('Failed to load batch details', 'error');
        }
    },

    extractSupplierURL(notes) {
        if (!notes) return null;
        // Match http:// or https:// URLs
        const urlMatch = notes.match(/https?:\/\/[^\s]+/);
        return urlMatch ? urlMatch[0] : null;
    },

    shortenURL(url) {
        try {
            const urlObj = new URL(url);
            let shortened = urlObj.hostname;
            if (urlObj.pathname !== '/') {
                const path = urlObj.pathname.slice(0, 30);
                shortened += path + (urlObj.pathname.length > 30 ? '...' : '');
            }
            return shortened;
        } catch {
            return url.slice(0, 40) + (url.length > 40 ? '...' : '');
        }
    },

    formatDate(dateStr) {
        if (!dateStr) return 'N/A';
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch {
            return dateStr;
        }
    },

    openEdit() {
        console.log('batchDetail.openEdit() called, currentStock:', this.currentStock);
        if (this.currentStock) {
            // Pass the full stock object, not just the ID
            const stockToEdit = this.currentStock;
            this.close();
            batchEditor.show(stockToEdit);
        } else {
            console.error('openEdit: currentStock is null');
            toast.show('Error: No batch selected', 'error');
        }
    },

    viewHistory() {
        this.close();
        router.navigate('history');
        // Could filter history by this stock item in future
    },

    async deleteBatch() {
        if (!this.currentStock) return;

        const confirmed = confirm(
            `Are you sure you want to delete this batch?\n\n` +
            `Part: ${state.parts.get(this.currentStock.part)?.name || 'Unknown'}\n` +
            `Quantity: ${this.currentStock.quantity}\n\n` +
            `This action cannot be undone.`
        );

        if (!confirmed) return;

        try {
            await api.request(`/stock/${this.currentStock.pk}/`, { method: 'DELETE' });
            notifications.show('Batch deleted successfully', 'success');
            this.close();

            // Refresh wall and catalog
            wall.loadLiveData();
            catalog.reload();
        } catch (e) {
            console.error('Failed to delete batch:', e);
            notifications.show('Failed to delete batch', 'error');
        }
    },

    close() {
        document.getElementById('batchDetailModal').classList.remove('active');
        this.currentStock = null;
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
        const deleteBtn = document.getElementById('batchEditDelete');
        const form = document.getElementById('batchEditForm');

        if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.hide());
        if (deleteBtn) deleteBtn.addEventListener('click', () => this.confirmDelete());
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.hide();
            });
        }
        if (form) form.addEventListener('submit', (e) => this.submit(e));
    },

    show(stockItem) {
        console.log('batchEditor.show() called with:', stockItem);

        if (!stockItem) {
            console.error('batchEditor.show() received null/undefined stockItem');
            toast.show('Error: No batch data', 'error');
            return;
        }

        this.currentStock = stockItem;
        const modal = document.getElementById('batchEditModal');

        if (!modal) {
            console.error('batchEditModal element not found in DOM');
            toast.show('Error: Edit modal not found', 'error');
            return;
        }

        try {
            // Populate form with existing values
            const qtyInput = document.getElementById('batchEditQty');
            const priceInput = document.getElementById('batchEditPrice');

            if (qtyInput) {
                qtyInput.value = stockItem.quantity ?? 0;
                console.log('Set quantity to:', stockItem.quantity);
            }
            if (priceInput) {
                priceInput.value = stockItem.purchase_price ?? 0;
                console.log('Set price to:', stockItem.purchase_price);
            }

            // Show current location in readonly info
            // Try multiple sources for location name
            let currentLocName = 'Unknown';
            if (stockItem.location_detail?.name) {
                currentLocName = stockItem.location_detail.name;
            } else if (stockItem.location) {
                // Try to get from state.locations
                for (const [name, loc] of state.locations.entries()) {
                    if (loc.pk === stockItem.location) {
                        currentLocName = name;
                        break;
                    }
                }
            }
            document.getElementById('batchEditLocation').textContent = currentLocName;

            // Show part name - try multiple sources
            let partName = 'Unknown Part';
            if (stockItem.part_detail?.name) {
                partName = stockItem.part_detail.name;
            } else if (stockItem.part && state.parts.has(stockItem.part)) {
                partName = state.parts.get(stockItem.part).name;
            }
            document.getElementById('batchEditPartName').textContent = partName;

            // Populate location dropdown
            const locSelect = document.getElementById('batchEditLocationSelect');
            if (locSelect) {
                locSelect.innerHTML = '<option value="">Keep current location</option>';

                // Add all bin locations (matches patterns like A-1-3-A, B-2-4-B, etc.)
                for (const [name, loc] of state.locations.entries()) {
                    if (name.match(/^[A-Z]-\d+-\d+-[AB]$/) || name.match(/^[A-Z]-\d+-\d+$/)) {
                        const option = new Option(name, loc.pk);
                        // Mark current location
                        if (loc.pk === stockItem.location) {
                            option.text += ' (current)';
                            option.disabled = true;
                        }
                        locSelect.appendChild(option);
                    }
                }
            }

            modal.classList.add('active');
            console.log('batchEditModal opened with values:', {
                qty: qtyInput?.value,
                price: priceInput?.value,
                location: currentLocName,
                part: partName
            });
            qtyInput?.focus();
        } catch (e) {
            console.error('Error in batchEditor.show():', e);
            toast.show('Error opening edit modal', 'error');
        }
    },

    hide() {
        document.getElementById('batchEditModal').classList.remove('active');
        this.currentStock = null;
    },

    /**
     * Show editor by fetching stock data first (for direct edit button)
     */
    async showById(stockId) {
        try {
            const stock = await api.request(`/stock/${stockId}/?part_detail=true&location_detail=true`);
            this.show(stock);
        } catch (e) {
            console.error('Failed to load stock:', e);
            toast.show('Failed to load batch data', 'error');
        }
    },

    async submit(e) {
        e.preventDefault();

        if (!this.currentStock) {
            console.error('submit: currentStock is null');
            toast.show('Error: No batch data', 'error');
            return;
        }

        // Get stock ID - InvenTree uses 'pk' as the primary key
        const stockId = this.currentStock.pk || this.currentStock.id;
        if (!stockId) {
            console.error('submit: No stock ID found', this.currentStock);
            toast.show('Error: Invalid batch data', 'error');
            return;
        }

        const qty = parseFloat(document.getElementById('batchEditQty').value);
        const price = parseFloat(document.getElementById('batchEditPrice').value);
        const newLocationId = document.getElementById('batchEditLocationSelect').value;

        console.log('batchEditor.submit():', { stockId, qty, price, newLocationId });

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
                console.log(`Location change detected: moving stock to new location`);

                // Transfer stock to new location
                await handshake.moveStock(stockId, parseInt(newLocationId), qty);
                toast.show('Batch moved to new location', 'success');
            }

            // Update quantity and price
            console.log(`Updating stock ${stockId}: qty=${qty}, price=${price}`);
            await api.request(`/stock/${stockId}/`, {
                method: 'PATCH',
                body: JSON.stringify({
                    quantity: qty,
                    purchase_price: price
                })
            });

            toast.show('Batch updated successfully', 'success');
            this.hide();

            // Refresh the catalog and wall to show updated data
            await catalog.reload();

            // Reload batches for the currently expanded part if in catalog
            if (state.expandedPart) {
                await catalog.loadBatches(state.expandedPart);
            }

            wall.loadLiveData();

        } catch (e) {
            console.error('Batch update error:', e);
            console.error('Stock object was:', this.currentStock);
            toast.show(`Failed to update batch: ${e.message}`, 'error');
        }
    },

    confirmDelete() {
        if (!this.currentStock) {
            toast.show('Error: No batch selected', 'error');
            return;
        }

        // Get part name for confirmation message
        let partName = 'this batch';
        if (this.currentStock.part_detail?.name) {
            partName = this.currentStock.part_detail.name;
        } else if (this.currentStock.part && state.parts.has(this.currentStock.part)) {
            partName = state.parts.get(this.currentStock.part).name;
        }

        const qty = this.currentStock.quantity || 0;
        const confirmed = confirm(
            `DELETE BATCH\n\n` +
            `Are you sure you want to permanently delete this batch?\n\n` +
            `Part: ${partName}\n` +
            `Quantity: ${qty} units\n\n` +
            `This action cannot be undone.`
        );

        if (confirmed) {
            this.delete();
        }
    },

    async delete() {
        if (!this.currentStock) return;

        const stockId = this.currentStock.pk || this.currentStock.id;
        if (!stockId) {
            toast.show('Error: Invalid batch data', 'error');
            return;
        }

        try {
            console.log(`Deleting stock ${stockId}...`);

            await api.request(`/stock/${stockId}/`, {
                method: 'DELETE'
            });

            toast.show('Batch deleted successfully', 'success');
            this.hide();

            // Refresh the catalog and wall
            await catalog.reload();

            if (state.expandedPart) {
                await catalog.loadBatches(state.expandedPart);
            }

            wall.loadLiveData();

        } catch (e) {
            console.error('Batch delete error:', e);
            toast.show(`Failed to delete batch: ${e.message}`, 'error');
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

        console.log(`Loaded ${bins.length} bins into location dropdown`);
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
            // Refresh parts list
            await catalog.reload();

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
            // Refresh parts list
            await catalog.reload();

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
// =============================================================================
// Notification System (Top-Right Stack)
// =============================================================================
const notifications = {
    queue: [],
    maxVisible: 5,

    show(message, type = 'info', options = {}) {
        const id = `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const notif = {
            id,
            message,
            type,  // 'info', 'success', 'error', 'warning'
            title: options.title || this.getDefaultTitle(type),
            autoDismiss: options.autoDismiss !== false,
            timeout: options.timeout || 5000
        };

        this.queue.push(notif);
        this.render();

        if (notif.autoDismiss) {
            setTimeout(() => this.dismiss(id), notif.timeout);
        }
    },

    getDefaultTitle(type) {
        const titles = {
            'info': 'Info',
            'success': 'Success',
            'error': 'Error',
            'warning': 'Warning'
        };
        return titles[type] || 'Notification';
    },

    getIcon(type) {
        const icons = {
            'info': '',
            'success': '',
            'error': '✕',
            'warning': ''
        };
        return icons[type] || '';
    },

    dismiss(id) {
        const index = this.queue.findIndex(n => n.id === id);
        if (index > -1) {
            this.queue.splice(index, 1);
            this.render();
        }
    },

    render() {
        const container = document.getElementById('notificationContainer');
        if (!container) return;

        // Show only the most recent maxVisible notifications
        const visibleNotifs = this.queue.slice(-this.maxVisible);

        container.innerHTML = visibleNotifs.map(notif => `
            <div class="notification ${notif.type}" data-id="${notif.id}">
                <div class="notification-icon">${this.getIcon(notif.type)}</div>
                <div class="notification-content">
                    <div class="notification-title">${notif.title}</div>
                    <div class="notification-message">${notif.message}</div>
                </div>
                <button class="notification-dismiss" onclick="notifications.dismiss('${notif.id}')">×</button>
            </div>
        `).join('');
    }
};

// Legacy toast support (backward compatibility)
const toast = {
    show(message, isError = false) {
        notifications.show(message, isError ? 'error' : 'success');
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
        // No longer creating sidebar widget - alerts now show in catalog view
    },

    /**
     * Check all parts for low stock
     */
    async checkLowStock() {
        this.lowStockItems = [];

        try {
            // Optimized: Fetch all parts that track stock and compare with minimum
            // Since we can't easily filter "low stock" on backend without custom filter,
            // we fetch a lightweight list of parts (e.g., limit 1000) and check locally.
            // This is 1 request vs N requests.
            const response = await api.getParts({ limit: 2000 }); // Reasonable limit for now
            const parts = response.results || [];

            parts.forEach(part => {
                const minStock = parseFloat(part.minimum_stock) || 0;
                if (minStock <= 0) return;

                const inStock = parseFloat(part.in_stock) || 0;

                // Also update cache while we are here
                state.parts.set(part.pk, part);

                if (inStock < minStock) {
                    this.lowStockItems.push({
                        pk: part.pk,
                        name: part.name,
                        sku: part.IPN || `PK-${part.pk}`,
                        available: inStock,
                        minimum: minStock,
                        shortage: minStock - inStock
                    });
                }
            });

        } catch (e) {
            console.error('Failed to check low stock:', e);
        }

        this.alertCount = this.lowStockItems.length;
        this.updateCatalogCard();
        this.updateWallCells();

        if (this.alertCount > 0) {
            console.log(`${this.alertCount} parts below minimum stock`);
        }

        return this.lowStockItems;
    },

    /**
     * Update the catalog alert card UI
     */
    updateCatalogCard() {
        const card = document.getElementById('lowStockAlertCard');
        const countBadge = document.getElementById('lowStockCount');
        const listEl = document.getElementById('lowStockCardList');

        if (!card) return;

        if (this.alertCount === 0) {
            card.style.display = 'none';
            return;
        }

        card.style.display = 'block';
        if (countBadge) {
            countBadge.textContent = this.alertCount;
        }

        if (listEl) {
            listEl.innerHTML = this.lowStockItems.map(item => `
                <div class="alert-card-item" onclick="catalog.scrollToPart(${item.pk})">
                    <div class="alert-item-name">${item.name}</div>
                    <div class="alert-item-stock">
                        <span class="stock-current">${item.available}</span>
                        <span class="stock-separator">/</span>
                        <span class="stock-minimum">${item.minimum}</span>
                    </div>
                </div>
            `).join('');
        }
    },

    /**
     * Update Wall cell colors based on stock levels
     */
    updateWallCells() {
        // This would update Wall cells when we have live stock data
        // For now, just log the warning state
        this.lowStockItems.forEach(item => {
            console.log(`Low stock: ${item.name} (${item.available}/${item.minimum})`);
        });
    }
};

/**
 * Toggle low stock dropdown visibility
 */
function toggleLowStockDropdown() {
    const dropdown = document.getElementById('lowStockDropdown');
    const expandBtn = document.getElementById('lowStockExpandBtn');

    if (!dropdown || !expandBtn) return;

    const isVisible = dropdown.style.display === 'block';
    dropdown.style.display = isVisible ? 'none' : 'block';
    expandBtn.classList.toggle('expanded', !isVisible);
}

// =============================================================================
// History & Archive System
// =============================================================================
const history = {
    movements: [],
    filters: {},
    loading: false,

    async init() {
        console.log('Initializing History view...');
        await this.loadMovements();
        this.render();
    },

    async loadMovements(filters = {}) {
        this.loading = true;
        this.showLoading();

        try {
            // Use InvenTree's stock tracking API
            // GET /api/stock/track/ returns stock movement history
            const params = new URLSearchParams({
                limit: 100,
                ordering: '-date',  // Most recent first
                ...filters
            });

            const response = await api.request(`/stock/track/?${params}`);
            this.movements = response.results || response || [];

            console.log(`Loaded ${this.movements.length} stock movements`);
        } catch (e) {
            console.error('Failed to load stock movements:', e);
            notifications.show('Failed to load history', 'error');
            this.movements = [];
        } finally {
            this.loading = false;
        }
    },

    showLoading() {
        const timeline = document.getElementById('historyTimeline');
        if (!timeline) return;

        timeline.innerHTML = `
            <div class="history-loading">
                <div class="spinner"></div>
                <p>Loading history...</p>
            </div>
        `;
    },

    render() {
        const timeline = document.getElementById('historyTimeline');
        if (!timeline) return;

        if (this.movements.length === 0) {
            timeline.innerHTML = `
                <div class="history-empty">
                    <div class="history-empty-icon"></div>
                    <div class="history-empty-text">No stock movements found</div>
                    <div class="history-empty-hint">Stock movements will appear here as you add, remove, or transfer inventory</div>
                </div>
            `;
            return;
        }

        timeline.innerHTML = this.movements.map(movement => this.renderMovement(movement)).join('');
    },

    renderMovement(movement) {
        const type = this.getMovementType(movement);
        const icon = this.getIcon(type);
        const date = new Date(movement.date);
        const formattedDate = this.formatDate(date);

        // Get part name from state if available
        const partName = movement.item_detail?.part_detail?.name ||
                        movement.part_detail?.name ||
                        `Part #${movement.item || movement.part}`;

        return `
            <div class="history-item">
                <div class="history-item-icon ${type}">
                    ${icon}
                </div>
                <div class="history-item-content">
                    <div class="history-item-header">
                        <span class="history-item-type ${type}">${this.getTypeLabel(type)}</span>
                        <span class="history-item-timestamp">${formattedDate}</span>
                    </div>
                    <div class="history-item-title">${partName}</div>
                    <div class="history-item-details">
                        ${this.renderDetails(movement, type)}
                    </div>
                    ${movement.notes ? `<div class="history-item-notes">${movement.notes}</div>` : ''}
                </div>
            </div>
        `;
    },

    getMovementType(movement) {
        // InvenTree tracking types: ADD, REMOVE, MOVE, UPDATE, etc.
        const trackingType = movement.tracking_type || '';

        if (trackingType.includes('ADD') || trackingType.includes('RECEIVE')) return 'add';
        if (trackingType.includes('REMOVE') || trackingType.includes('CONSUME')) return 'remove';
        if (trackingType.includes('MOVE') || trackingType.includes('TRANSFER')) return 'move';
        return 'update';
    },

    getIcon(type) {
        const icons = {
            'add': '',
            'remove': '',
            'move': '',
            'update': ''
        };
        return icons[type] || '';
    },

    getTypeLabel(type) {
        const labels = {
            'add': 'Stock Added',
            'remove': 'Stock Removed',
            'move': 'Transferred',
            'update': 'Updated'
        };
        return labels[type] || 'Stock Movement';
    },

    renderDetails(movement, type) {
        let details = [];

        // Quantity
        if (movement.quantity) {
            details.push(`
                <div class="history-detail-item">
                    <span class="history-detail-label">Quantity</span>
                    <span class="history-detail-value mono highlight">${movement.quantity}</span>
                </div>
            `);
        }

        // Location (from/to)
        if (type === 'move') {
            if (movement.location_detail) {
                details.push(`
                    <div class="history-detail-item">
                        <span class="history-detail-label">To Location</span>
                        <span class="history-detail-value">${movement.location_detail.name || 'Unknown'}</span>
                    </div>
                `);
            }
        } else if (movement.location_detail) {
            details.push(`
                <div class="history-detail-item">
                    <span class="history-detail-label">Location</span>
                    <span class="history-detail-value">${movement.location_detail.name || 'Unknown'}</span>
                </div>
            `);
        }

        // User
        if (movement.user_detail) {
            details.push(`
                <div class="history-detail-item">
                    <span class="history-detail-label">User</span>
                    <span class="history-detail-value">${movement.user_detail.username || 'Unknown'}</span>
                </div>
            `);
        }

        // Tracking type
        if (movement.tracking_type) {
            details.push(`
                <div class="history-detail-item">
                    <span class="history-detail-label">Type</span>
                    <span class="history-detail-value">${movement.tracking_type}</span>
                </div>
            `);
        }

        return details.join('');
    },

    formatDate(date) {
        const now = new Date();
        const diff = now - date;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 7) {
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        } else if (days > 0) {
            return `${days} day${days > 1 ? 's' : ''} ago`;
        } else if (hours > 0) {
            return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else if (minutes > 0) {
            return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        } else {
            return 'Just now';
        }
    },

    async applyFilters() {
        const type = document.getElementById('historyFilterType')?.value;
        const startDate = document.getElementById('historyStartDate')?.value;
        const endDate = document.getElementById('historyEndDate')?.value;

        this.filters = {};

        if (type) {
            this.filters.tracking_type = type;
        }

        if (startDate) {
            this.filters.min_date = startDate;
        }

        if (endDate) {
            this.filters.max_date = endDate;
        }

        await this.loadMovements(this.filters);
        this.render();
    },

    clearFilters() {
        // Reset filter inputs
        const typeFilter = document.getElementById('historyFilterType');
        const startDate = document.getElementById('historyStartDate');
        const endDate = document.getElementById('historyEndDate');

        if (typeFilter) typeFilter.value = '';
        if (startDate) startDate.value = '';
        if (endDate) endDate.value = '';

        this.filters = {};
        this.loadMovements();
        this.render();
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
        console.log('API Connected');
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
    console.log('Omiximo Inventory OS starting...');

    // Clock
    updateClock();
    setInterval(updateClock, 1000);

    // Theme
    theme.init();

    // Router
    router.init();

    // Zone Configuration
    zoneConfig.init();

    // Shelf Configuration (Bin A/B FIFO settings)
    shelfConfig.init();

    // Wall
    wall.init();

    // Modals
    binModal.init();
    binInfoModal.init();
    handshake.init();
    partManager.init();
    batchEditor.init();
    categoryManager.init();

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
            await auth.onAuthSuccess();
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
                await this.onAuthSuccess();
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
        console.log('Authenticated');

        // Hide login modal
        document.getElementById('loginModal').classList.remove('active');
        document.body.classList.remove('not-authenticated');

        // Load data
        await checkConnection();
        await loadLocations();
        // REMOVED: await loadParts(); // Non-blocking boot


        // Load live wall data
        await wall.loadLiveData();

        // Render catalog
        if (document.getElementById('view-catalog').classList.contains('active')) {
            catalog.reload();
        } else {
            // Preload first page silently? Or wait until user clicks?
            // Let's lazy load.
        }

        // Initialize Tenant Module
        if (typeof tenant !== 'undefined') {
            await tenant.checkSuperAdmin();
            tenant.init();
        }

        // Check low stock (This loads parts into state.parts)
        await alerts.checkLowStock();

        // Initialize Profit Engine (AFTER parts are loaded)
        if (typeof profitEngine !== 'undefined') {
            profitEngine.init();
        }

        // View restoration is now handled in router.init()

        // Periodic refresh
        setInterval(async () => {
            await checkConnection();
            // REMOVED: await loadParts(); // Avoiding DDoS
            await wall.loadLiveData();
            await alerts.checkLowStock();
        }, CONFIG.REFRESH_INTERVAL);

        toast.show('Welcome back!');
        console.log('Ready');
    },

    logout() {
        localStorage.removeItem('inventree_token');
        CONFIG.API_TOKEN = null;
        location.reload();
    }
};

// Expose zone modules globally for inline onclick handlers
window.zoneConfig = zoneConfig;
window.zoneManager = zoneManager;

document.addEventListener('DOMContentLoaded', async () => {
    // Initialize UI structure first (creates DOM elements)
    await init();

    // Then handle authentication (which may populate those elements)
    await auth.init();
});
