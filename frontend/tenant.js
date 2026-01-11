/**
 * =============================================================================
 * OMIXIMO INVENTORY OS - Tenant Management Module
 * Handles multi-tenancy: context switching, tenant CRUD, user assignment
 * =============================================================================
 */

const tenant = {
    // Current tenant context (null = super admin sees all)
    current: null,

    // Cached tenant list
    tenants: [],

    // Super admin check
    isSuperAdmin: false,

    /**
     * Initialize tenant module
     */
    init() {
        console.log('Initializing tenant module...');

        // Load tenant context from localStorage
        const savedTenant = localStorage.getItem('omiximo_tenant');
        if (savedTenant) {
            try {
                this.current = JSON.parse(savedTenant);
                console.log(`Restored tenant context: ${this.current.name}`);
            } catch (e) {
                console.warn('Invalid saved tenant, clearing');
                localStorage.removeItem('omiximo_tenant');
            }
        }

        // Load tenants list
        this.loadTenants();

        // Render tenant selector if super admin
        this.renderSelector();
    },

    /**
     * Load available tenants from API
     */
    async loadTenants() {
        try {
            // Get groups that start with "tenant_"
            const resp = await fetch(`${CONFIG.API_BASE}/user/group/`, {
                headers: auth.getHeaders()
            });

            if (resp.ok) {
                const groups = await resp.json();
                this.tenants = groups.filter(g => g.name.startsWith('tenant_')).map(g => ({
                    id: g.pk,
                    name: g.name.replace('tenant_', ''),
                    displayName: g.name.replace('tenant_', '').replace(/_/g, ' ').toUpperCase(),
                    groupId: g.pk
                }));
                console.log(`Loaded ${this.tenants.length} tenants`);
            }
        } catch (e) {
            console.error('Failed to load tenants:', e);
        }
    },

    /**
     * Check if current user is super admin
     */
    async checkSuperAdmin() {
        try {
            const resp = await fetch(`${CONFIG.API_BASE}/user/me/`, {
                headers: auth.getHeaders()
            });

            if (resp.ok) {
                const user = await resp.json();
                // Super admin is staff or superuser
                this.isSuperAdmin = user.is_staff || user.is_superuser;

                // If not super admin, determine tenant from user's groups
                if (!this.isSuperAdmin && user.groups) {
                    const tenantGroup = user.groups.find(g => g.name && g.name.startsWith('tenant_'));
                    if (tenantGroup) {
                        this.current = {
                            id: tenantGroup.pk,
                            name: tenantGroup.name.replace('tenant_', ''),
                            groupId: tenantGroup.pk
                        };
                        console.log(`User tenant: ${this.current.name}`);
                    }
                }

                return this.isSuperAdmin;
            }
        } catch (e) {
            console.error('Failed to check super admin:', e);
        }
        return false;
    },

    /**
     * Switch to a different tenant context (super admin only)
     */
    switchTenant(tenantId) {
        if (!this.isSuperAdmin) {
            console.warn('Only super admin can switch tenants');
            return;
        }

        if (tenantId === null || tenantId === 'all') {
            this.current = null;
            localStorage.removeItem('omiximo_tenant');
            console.log('Switched to ALL TENANTS view');
            toast.show('Viewing all tenants', 'info');
        } else {
            const tenant = this.tenants.find(t => t.id === tenantId || t.name === tenantId);
            if (tenant) {
                this.current = tenant;
                localStorage.setItem('omiximo_tenant', JSON.stringify(tenant));
                console.log(`Switched to tenant: ${tenant.displayName}`);
                toast.show(`Switched to ${tenant.displayName}`, 'success');
            }
        }

        // Refresh data
        this.refreshData();
    },

    /**
     * Refresh current view data with new tenant context
     */
    async refreshData() {
        console.log('Refreshing data for tenant:', this.current?.name || 'ALL');

        // Reload locations and parts with new tenant filter
        if (typeof loadLocations === 'function') {
            await loadLocations();
        }
        if (typeof loadParts === 'function') {
            await loadParts();
        }

        // Refresh wall grid
        if (typeof wall !== 'undefined' && wall.loadLiveData) {
            await wall.loadLiveData();
        }

        // Refresh catalog
        if (typeof catalog !== 'undefined' && catalog.render) {
            catalog.render();
        }
    },

    /**
     * Render tenant selector in header (super admin only)
     */
    renderSelector() {
        const container = document.getElementById('tenantSelectorContainer');
        if (!container) return;

        if (!this.isSuperAdmin) {
            container.style.display = 'none';
            return;
        }

        container.style.display = 'flex';
        container.innerHTML = `
            <div class="tenant-selector">
                <select id="tenantSelect" onchange="tenant.switchTenant(this.value)">
                    <option value="all" ${!this.current ? 'selected' : ''}>All Tenants</option>
                    ${this.tenants.map(t => `
                        <option value="${t.id}" ${this.current?.id === t.id ? 'selected' : ''}>
                            ${t.displayName}
                        </option>
                    `).join('')}
                </select>
                <button class="btn-add-tenant" onclick="tenant.showCreateModal()" title="Create Tenant">+</button>
            </div>
        `;
    },

    /**
     * Get current tenant filter for API calls
     * Returns query params to filter by tenant's locations/parts
     */
    getFilter() {
        if (!this.current) {
            return {}; // No filter for super admin viewing all
        }

        // Filter by tenant's root location (parent warehouse)
        // Locations: filter by parent name containing tenant name
        // Parts: we'll rely on location filtering for stock visibility
        return {
            parent__name__icontains: this.current.name
        };
    },

    /**
     * Create a new tenant
     */
    async createTenant(name, displayName, description = '') {
        if (!this.isSuperAdmin) {
            toast.show('Only super admin can create tenants', 'error');
            return null;
        }

        try {
            // Create group
            const groupResp = await fetch(`${CONFIG.API_BASE}/user/group/`, {
                method: 'POST',
                headers: {
                    ...auth.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: `tenant_${name}`
                })
            });

            if (!groupResp.ok) {
                throw new Error('Failed to create tenant group');
            }

            const group = await groupResp.json();

            // Create root location
            const locationResp = await fetch(`${CONFIG.API_BASE}/stock/location/`, {
                method: 'POST',
                headers: {
                    ...auth.getHeaders(),
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: `${displayName} Warehouse`,
                    description: description
                })
            });

            if (!locationResp.ok) {
                console.warn('Failed to create tenant location');
            }

            // Reload tenants
            await this.loadTenants();
            this.renderSelector();

            toast.show(`Tenant "${displayName}" created`, 'success');
            return group;

        } catch (e) {
            console.error('Failed to create tenant:', e);
            toast.show('Failed to create tenant', 'error');
            return null;
        }
    },

    /**
     * Open create tenant modal
     */
    showCreateModal() {
        const modal = document.getElementById('createTenantModal');
        if (modal) {
            modal.classList.add('active');
        }
    },

    /**
     * Handle create tenant form submission
     */
    async handleCreateSubmit(event) {
        event.preventDefault();

        const name = document.getElementById('tenantName').value.toLowerCase().replace(/\s+/g, '_');
        const displayName = document.getElementById('tenantDisplayName').value;
        const description = document.getElementById('tenantDescription').value;

        if (name && displayName) {
            await this.createTenant(name, displayName, description);

            // Close modal
            const modal = document.getElementById('createTenantModal');
            if (modal) {
                modal.classList.remove('active');
            }

            // Reset form
            event.target.reset();
        }
    }
};

// Expose globally
window.tenant = tenant;
