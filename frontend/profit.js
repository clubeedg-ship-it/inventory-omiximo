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
    init() {
        // Initialize Record Sale module
        recordSale.init();

        // Load saved transactions from localStorage
        recordSale.loadTransactions();

        // Render UI
        this.render();
    },

    render() {
        this.renderSummary();
        this.renderTransactions();
    },

    renderSummary() {
        const marginEl = document.getElementById('todayMargin');
        const countEl = document.getElementById('txCount');

        if (marginEl) {
            marginEl.textContent = `${profitState.totalMargin >= 0 ? '' : '-'}€${Math.abs(profitState.totalMargin).toFixed(2)}`;
            marginEl.className = `value ${profitState.totalMargin >= 0 ? 'positive' : 'negative'}`;
        }

        if (countEl) {
            countEl.textContent = profitState.transactions.length;
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
