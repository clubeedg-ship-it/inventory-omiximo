/**
 * =============================================================================
 * OMIXIMO INVENTORY OS - Profit Engine
 * Real FIFO Cost Calculation & Transaction Recording
 * =============================================================================
 */

// =============================================================================
// Profit State
// =============================================================================
const profitState = {
    transactions: [],
    totalMargin: 0,
    inventoryValue: 0,
    currentScope: 'day', // day | week | month | year
    cashFlowScope: 'today',
    currentSubView: 'main', // main | inventory
    components: [], // Components added to current sale
    stockCache: new Map() // partId -> stock items for FIFO
};

// =============================================================================
// Record Sale Module
// =============================================================================
const recordSale = {
    init() {
        console.log('🔷 recordSale.init() starting...');

        const modal = document.getElementById('recordSaleModal');
        const closeBtn = document.getElementById('recordSaleClose');
        const cancelBtn = document.getElementById('recordSaleCancel');
        const form = document.getElementById('recordSaleForm');
        const addBtn = document.getElementById('addComponentBtn');
        const salePriceInput = document.getElementById('salePrice');
        const openBtn = document.getElementById('btnRecordSale');

        console.log('🔷 DOM elements found:', {
            modal: !!modal,
            closeBtn: !!closeBtn,
            cancelBtn: !!cancelBtn,
            form: !!form,
            addBtn: !!addBtn,
            salePriceInput: !!salePriceInput,
            openBtn: !!openBtn
        });

        if (closeBtn) closeBtn.addEventListener('click', () => this.hide());
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.hide());
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.hide();
            });
        }
        if (form) form.addEventListener('submit', (e) => this.submit(e));
        if (addBtn) addBtn.addEventListener('click', () => this.addComponent());
        if (salePriceInput) salePriceInput.addEventListener('input', () => this.updateMarginPreview());

        if (openBtn) {
            openBtn.addEventListener('click', () => {
                console.log('🔷 Record Sale button clicked!');
                this.show();
            });
            console.log('🔷 Event listener attached to Record Sale button');
        } else {
            console.error('🔴 Record Sale button not found!');
        }

        console.log('🔷 recordSale.init() complete');
    },

    async show() {
        const modal = document.getElementById('recordSaleModal');

        // Reset form
        document.getElementById('saleProductName').value = '';
        document.getElementById('salePrice').value = '';
        profitState.components = [];
        profitState.stockCache.clear();

        // Populate component dropdown with parts
        await this.populatePartsDropdown();

        // Clear components list
        this.renderComponentsList();
        this.updateCostDisplay();

        modal.classList.add('active');
        document.getElementById('saleProductName').focus();
    },

    hide() {
        document.getElementById('recordSaleModal').classList.remove('active');
    },

    async populatePartsDropdown() {
        const select = document.getElementById('componentSelect');
        select.innerHTML = '<option value="">Select component...</option>';

        // Get parts from state (already loaded by main app)
        if (state.parts && state.parts.size > 0) {
            state.parts.forEach((part, pk) => {
                const inStock = part.in_stock ?? 0;
                if (inStock > 0) {
                    const opt = document.createElement('option');
                    opt.value = pk;
                    opt.textContent = `${part.name} (${inStock} in stock)`;
                    select.appendChild(opt);
                }
            });
        }
    },

    async addComponent() {
        const select = document.getElementById('componentSelect');
        const qtyInput = document.getElementById('componentQty');

        const partId = parseInt(select.value);
        const qty = parseInt(qtyInput.value) || 1;

        if (!partId) {
            toast.show('Please select a component', 'error');
            return;
        }

        const part = state.parts.get(partId);
        if (!part) return;

        // Check if already added
        const existing = profitState.components.find(c => c.partId === partId);
        if (existing) {
            existing.qty += qty;
        } else {
            // Calculate FIFO cost for this component
            const fifoResult = await this.calculateFifoCost(partId, qty);

            if (!fifoResult.success) {
                toast.show(`Insufficient stock for ${part.name}`, 'error');
                return;
            }

            profitState.components.push({
                partId,
                partName: part.name,
                qty,
                fifoCost: fifoResult.totalCost,
                batchesUsed: fifoResult.batchesUsed
            });
        }

        // Reset inputs
        select.value = '';
        qtyInput.value = '1';

        // Refresh UI
        this.renderComponentsList();
        this.updateCostDisplay();
    },

    async calculateFifoCost(partId, qtyNeeded) {
        // Get or fetch stock items for this part
        let stocks = profitState.stockCache.get(partId);

        if (!stocks) {
            stocks = await api.getStockForPart(partId);
            // Sort by date (oldest first) - FIFO
            stocks.sort((a, b) => new Date(a.updated || a.created) - new Date(b.updated || b.created));
            profitState.stockCache.set(partId, stocks);
        }

        let remaining = qtyNeeded;
        let totalCost = 0;
        const batchesUsed = [];

        for (const stock of stocks) {
            if (remaining <= 0) break;

            const availableQty = stock.quantity || 0;
            const unitCost = parseFloat(stock.purchase_price) || 0;

            if (availableQty <= 0) continue;

            const takeQty = Math.min(remaining, availableQty);
            const cost = takeQty * unitCost;

            batchesUsed.push({
                stockId: stock.pk,
                qty: takeQty,
                unitCost,
                subtotal: cost,
                location: stock.location_detail?.name || 'Unknown'
            });

            totalCost += cost;
            remaining -= takeQty;
        }

        if (remaining > 0) {
            return { success: false, totalCost: 0, batchesUsed: [] };
        }

        return { success: true, totalCost, batchesUsed };
    },

    renderComponentsList() {
        const container = document.getElementById('saleComponentsList');

        if (profitState.components.length === 0) {
            container.innerHTML = '<div class="empty-components">No components added yet</div>';
            return;
        }

        container.innerHTML = profitState.components.map((c, idx) => `
            <div class="component-item" data-idx="${idx}">
                <div class="component-info">
                    <span class="component-name">${c.partName} × ${c.qty}</span>
                    <span class="component-cost">FIFO Cost: €${c.fifoCost.toFixed(2)}</span>
                </div>
                <button type="button" class="component-remove" data-idx="${idx}">×</button>
            </div>
        `).join('');

        // Attach remove handlers
        container.querySelectorAll('.component-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                profitState.components.splice(idx, 1);
                this.renderComponentsList();
                this.updateCostDisplay();
            });
        });
    },

    updateCostDisplay() {
        const totalCost = profitState.components.reduce((sum, c) => sum + c.fifoCost, 0);
        document.getElementById('saleTotalCost').textContent = `€${totalCost.toFixed(2)}`;
        this.updateMarginPreview();
    },

    updateMarginPreview() {
        const salePrice = parseFloat(document.getElementById('salePrice').value) || 0;
        const totalCost = profitState.components.reduce((sum, c) => sum + c.fifoCost, 0);
        const margin = salePrice - totalCost;

        const marginEl = document.getElementById('saleMarginPreview');
        marginEl.textContent = `${margin >= 0 ? '+' : ''}€${margin.toFixed(2)}`;
        marginEl.className = `value ${margin >= 0 ? 'positive' : 'negative'}`;
    },

    async submit(e) {
        e.preventDefault();

        const productName = document.getElementById('saleProductName').value.trim();
        const salePrice = parseFloat(document.getElementById('salePrice').value) || 0;
        const totalCost = profitState.components.reduce((sum, c) => sum + c.fifoCost, 0);

        if (profitState.components.length === 0) {
            toast.show('Please add at least one component', 'error');
            return;
        }

        // Consume stock from inventory (FIFO)
        try {
            for (const component of profitState.components) {
                for (const batch of component.batchesUsed) {
                    await api.request(`/stock/${batch.stockId}/`, {
                        method: 'PATCH',
                        body: JSON.stringify({
                            quantity: (await this.getStockQty(batch.stockId)) - batch.qty
                        })
                    });
                }
            }
        } catch (err) {
            toast.show('Failed to update inventory', 'error');
            console.error('Stock update error:', err);
            return;
        }

        // Create transaction record
        const orderId = `ORD-${Date.now().toString(36).toUpperCase()}`;
        const transaction = {
            orderId,
            productName,
            date: new Date().toISOString().split('T')[0],
            components: profitState.components.map(c => ({
                partName: c.partName,
                qty: c.qty,
                cost: c.fifoCost
            })),
            cost: totalCost,
            sale: salePrice,
            margin: salePrice - totalCost
        };

        // Save transaction
        profitState.transactions.unshift(transaction);
        profitState.totalMargin += transaction.margin;
        this.saveTransactions();

        // Refresh UI
        profitEngine.render();
        this.hide();

        // Refresh parts to show updated stock
        await loadParts();

        toast.show(`Sale recorded! Margin: €${transaction.margin.toFixed(2)}`, 'success');
    },

    async getStockQty(stockId) {
        const data = await api.request(`/stock/${stockId}/`);
        return data.quantity || 0;
    },

    saveTransactions() {
        localStorage.setItem('omiximo_transactions', JSON.stringify(profitState.transactions));
        localStorage.setItem('omiximo_totalMargin', profitState.totalMargin.toString());
    },

    loadTransactions() {
        const saved = localStorage.getItem('omiximo_transactions');
        const margin = localStorage.getItem('omiximo_totalMargin');

        if (saved) {
            profitState.transactions = JSON.parse(saved);
        }
        if (margin) {
            profitState.totalMargin = parseFloat(margin);
        }
    }
};

// =============================================================================
// Profit Engine Core
// =============================================================================
const profitEngine = {
    chart: null,

    async init() {
        // Initialize Record Sale module
        recordSale.init();

        // Load saved transactions from localStorage
        recordSale.loadTransactions();

        // Calculate initial inventory value (async)
        // Wait a bit for token to be available if needed, or call it safely
        setTimeout(() => this.calculateInventoryValue(), 1000);

        // Setup Event Listeners
        this.setupEventListeners();

        // Render UI
        this.render();
    },

    setupEventListeners() {
        // Chart Time Scope
        const scopeSelect = document.getElementById('chartTimeScope');
        if (scopeSelect) {
            scopeSelect.addEventListener('change', (e) => {
                profitState.currentScope = e.target.value;
                this.renderChart();
            });
        }

        // Cash Flow Scope
        const cashFlowSelect = document.getElementById('cashFlowScope');
        if (cashFlowSelect) {
            cashFlowSelect.addEventListener('change', (e) => {
                profitState.cashFlowScope = e.target.value;
                this.renderSummary(); // Summary handles cash flow update
            });
        }

        // Inventory Value Card Click -> Drill down
        const invCard = document.getElementById('cardInventoryValue');
        if (invCard) {
            invCard.addEventListener('click', () => {
                this.navigateToSubView('inventory');
            });
        }

        // Breadcrumb Navigation
        const breadcrumb = document.getElementById('profitBreadcrumb');
        if (breadcrumb) {
            breadcrumb.addEventListener('click', (e) => {
                if (e.target.classList.contains('crumb-item') && e.target.dataset.target) {
                    this.navigateToSubView(e.target.dataset.target);
                }
            });
        }
    },

    navigateToSubView(viewName) {
        profitState.currentSubView = viewName;
        const mainView = document.getElementById('profitMainView');
        const invView = document.getElementById('profitInventoryView');
        const breadcrumb = document.getElementById('profitBreadcrumb');

        // Reset Breadcrumb Base
        breadcrumb.innerHTML = '<span class="crumb-item clickable" data-target="main">Profitability Engine</span>';

        if (viewName === 'inventory') {
            mainView.classList.add('hidden');
            invView.classList.remove('hidden');

            // Add breadcrumb item
            const span = document.createElement('span');
            span.className = 'crumb-item active';
            span.textContent = 'Inventory Valuation';
            breadcrumb.appendChild(span);

            this.renderInventoryBreakdown();
        } else {
            // Default to main
            mainView.classList.remove('hidden');
            invView.classList.add('hidden');

            // Fix breadcrumb for main (remove clickable class from last item)
            breadcrumb.innerHTML = '<span class="crumb-item active" data-target="main">Profitability Engine</span>';

            this.renderChart(); // Re-render chart to ensure size is correct
        }
    },

    async calculateInventoryValue() {
        try {
            if (!state.token) return;

            // Fetch all stock items
            const response = await fetch(`${env.API_URL}/stock/`, {
                headers: { 'Authorization': `Token ${state.token}` }
            });

            if (!response.ok) throw new Error('Failed to fetch stock');

            const stockItems = await response.json();

            let totalVal = 0;
            const productBreakdown = {}; // We will implement breakdown logic later/here if easy

            stockItems.forEach(item => {
                const qty = parseFloat(item.quantity) || 0;
                // Use purchase_price if available, otherwise 0 for now as per constraints to use EXACT batch cost
                const price = item.purchase_price ? parseFloat(item.purchase_price) : 0;
                totalVal += qty * price;
            });

            profitState.inventoryValue = totalVal;

            // Update UI if we are in main view
            this.renderSummary();

            // Also store for breakdown rendering if needed, or re-fetch in renderInventoryBreakdown
            profitState.stockItems = stockItems; // Cache it

        } catch (err) {
            console.error('Inventory Value Calc Error:', err);
        }
    },

    render() {
        this.renderSummary();
        this.renderChart();
        this.renderTransactions();
    },

    renderChart() {
        const canvas = document.getElementById('profitChart');
        if (!canvas) return;

        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        if (this.chart) {
            this.chart.destroy();
        }

        const scope = profitState.currentScope;
        const transactions = profitState.transactions;
        const now = new Date();

        // Group Data Logic
        const groupedData = {};

        transactions.forEach(tx => {
            const txDate = new Date(tx.date);
            let key;

            if (scope === 'day') {
                if (txDate.toDateString() === now.toDateString()) {
                    key = txDate.getHours() + ':00';
                }
            } else if (scope === 'week') {
                const diffTime = Math.abs(now - txDate);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays <= 7) {
                    key = txDate.toLocaleDateString('en-US', { weekday: 'short' });
                }
            } else if (scope === 'month') {
                if (txDate.getMonth() === now.getMonth() && txDate.getFullYear() === now.getFullYear()) {
                    key = txDate.getDate();
                }
            } else if (scope === 'year') {
                if (txDate.getFullYear() === now.getFullYear()) {
                    key = txDate.toLocaleDateString('en-US', { month: 'short' });
                }
            }

            if (key) {
                if (!groupedData[key]) groupedData[key] = 0;
                groupedData[key] += (tx.margin || 0);
            }
        });

        let labels = Object.keys(groupedData);
        let dataPoints = Object.values(groupedData);

        // Fallback for empty/sample
        if (labels.length === 0) {
            if (scope === 'day') labels = ['9:00', '12:00', '15:00', '18:00'];
            else if (scope === 'week') labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
            else if (scope === 'month') labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
            else labels = ['Q1', 'Q2', 'Q3', 'Q4'];

            dataPoints = labels.map(() => 0);
        }

        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        const textColor = isDark ? '#ffffff' : '#333333';
        const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

        try {
            this.chart = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Profit Margin',
                        data: dataPoints,
                        borderColor: '#00dcb4',
                        backgroundColor: 'rgba(0, 220, 180, 0.1)',
                        borderWidth: 2,
                        tension: 0.4,
                        fill: true,
                        pointBackgroundColor: '#005066',
                        pointBorderColor: '#fff',
                        pointRadius: 4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        x: {
                            ticks: { color: textColor },
                            grid: { display: false }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                color: textColor,
                                callback: value => '€' + value
                            },
                            grid: { color: gridColor, borderDash: [5, 5] }
                        }
                    }
                }
            });
        } catch (err) {
            console.error('Chart Render Error:', err);
        }
    },

    renderSummary() {
        const marginEl = document.getElementById('todayMargin');
        const countEl = document.getElementById('txCount');
        const invEl = document.getElementById('totalInventoryValue');
        const cashFlowEl = document.getElementById('cashFlowValue');
        const heroInvEl = document.getElementById('heroInventoryValue');

        // Today's Margin
        const todayMargin = profitState.totalMargin; // Simplified for MVP (should filter by today)
        if (marginEl) {
            marginEl.textContent = `${todayMargin >= 0 ? '' : '-'}€${Math.abs(todayMargin).toFixed(2)}`;
            marginEl.className = `value ${todayMargin >= 0 ? 'positive' : 'negative'}`;
        }

        // Transactions Count
        if (countEl) {
            countEl.textContent = profitState.transactions.length;
        }

        // Inventory Value
        if (invEl) {
            invEl.textContent = `€${profitState.inventoryValue.toFixed(2)}`;
        }
        if (heroInvEl) {
            heroInvEl.textContent = `€${profitState.inventoryValue.toFixed(2)}`;
        }

        // Cash Flow (Sales Total based on scope)
        if (cashFlowEl) {
            let totalSales = 0;
            const scope = profitState.cashFlowScope;
            const now = new Date();

            profitState.transactions.forEach(tx => {
                const txDate = new Date(tx.date);
                let include = false;

                if (scope === 'today') {
                    if (txDate.toDateString() === now.toDateString()) include = true;
                } else if (scope === 'month') {
                    if (txDate.getMonth() === now.getMonth() && txDate.getFullYear() === now.getFullYear()) include = true;
                }

                if (include) totalSales += (tx.sale || 0);
            });

            cashFlowEl.textContent = `€${totalSales.toFixed(2)}`;
        }
    },

    /**
     * Render drill-down table of inventory
     */
    renderInventoryBreakdown() {
        const tbody = document.getElementById('inventoryBreakdownBody');
        if (!tbody) return;

        if (!profitState.stockItems || profitState.stockItems.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 2rem;">No stock data available</td></tr>';
            return;
        }

        // Group by Part
        const parts = {};

        profitState.stockItems.forEach(item => {
            if (!item.part) return;
            const partId = item.part;
            const partName = item.part_detail ? item.part_detail.name : `Part #${partId}`;

            if (!parts[partId]) {
                parts[partId] = {
                    name: partName,
                    totalQty: 0,
                    totalValue: 0,
                    batches: []
                };
            }

            const qty = parseFloat(item.quantity) || 0;
            const price = item.purchase_price ? parseFloat(item.purchase_price) : 0;
            const value = qty * price;

            parts[partId].totalQty += qty;
            parts[partId].totalValue += value;

            parts[partId].batches.push({
                id: item.pk,
                batch: item.batch || 'N/A',
                location: item.location_detail ? item.location_detail.name : 'Unknown',
                qty,
                price,
                value
            });
        });

        // Render HTML
        let html = '';
        Object.values(parts).forEach(part => {
            // Product Row
            const rowId = `part-${part.name.replace(/\s+/g, '-')}`;
            html += `
                <tr class="product-row clickable" onclick="toggleBatchRow(this)">
                    <td><span class="menu-arrow">▶</span> ${part.name}</td>
                    <td>${part.totalQty}</td>
                    <td>-</td>
                    <td>€${part.totalValue.toFixed(2)}</td>
                </tr>
             `;

            // Batches (Hidden by default, will use CSS logic or simple class toggle)
            // For MVP, just list them below with a different indent
            part.batches.forEach(batch => {
                html += `
                    <tr class="batch-row hidden">
                        <td style="padding-left: 2rem;">
                            <span style="opacity:0.7">Batch: ${batch.batch} (Loc: ${batch.location})</span>
                        </td>
                        <td>${batch.qty}</td>
                        <td>€${batch.price.toFixed(2)}</td>
                        <td>€${batch.value.toFixed(2)}</td>
                    </tr>
                 `;
            });
        });

        tbody.innerHTML = html;

        // Assign toggle handler globally if not exists
        if (!window.toggleBatchRow) {
            window.toggleBatchRow = (row) => {
                row.classList.toggle('expanded');
                let next = row.nextElementSibling;
                while (next && next.classList.contains('batch-row')) {
                    next.classList.toggle('hidden');
                    next = next.nextElementSibling;
                }
            };
        }
    },

    renderTransactions() {
        const container = document.getElementById('transactionsList');
        if (!container) return;

        if (profitState.transactions.length === 0) {
            container.innerHTML = `
                <div class="empty-transactions">
                    <p>No transactions yet</p>
                    <p>Click "Record Sale" to add your first sale</p>
                </div>
            `;
            return;
        }

        container.innerHTML = profitState.transactions.map(tx => `
            <div class="transaction-card" data-order="${tx.orderId}">
                <div class="transaction-header">
                    <span class="transaction-id">${tx.orderId}</span>
                    <span class="transaction-date">${tx.date}</span>
                </div>
                <div class="transaction-product">${tx.productName}</div>
                <div class="transaction-financials">
                    <span class="cost">Cost: €${tx.cost.toFixed(2)}</span>
                    <span class="sale">Sale: €${tx.sale.toFixed(2)}</span>
                    <span class="margin ${tx.margin >= 0 ? 'positive' : 'negative'}">
                        Margin: ${tx.margin >= 0 ? '+' : ''}€${tx.margin.toFixed(2)}
                    </span>
                </div>
                <div class="transaction-details">
                    <strong>Components Used:</strong>
                    ${tx.components.map(c => `
                        <div class="batch-used">
                            <span class="part">${c.partName} × ${c.qty}</span>
                            <span class="batch-info">€${c.cost.toFixed(2)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');

        // Add click handlers for expand/collapse
        container.querySelectorAll('.transaction-card').forEach(card => {
            card.addEventListener('click', () => {
                card.classList.toggle('expanded');
            });
        });
    }
};

// =============================================================================
// Expose modules globally for app.js integration
// Initialization is called from app.js onAuthSuccess() after parts are loaded
// =============================================================================
window.profitEngine = profitEngine;
window.recordSale = recordSale;
