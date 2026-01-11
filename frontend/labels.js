/**
 * =============================================================================
 * OMIXIMO INVENTORY OS - Label Printing Module
 * Barcode generation and print functionality
 * =============================================================================
 */

// =============================================================================
// Label Configuration
// =============================================================================
const LABEL_CONFIG = {
    WIDTH_MM: 50,
    HEIGHT_MM: 25,
    BARCODE_FORMAT: 'CODE128',
    BARCODE_HEIGHT: 40,
    FONT_SIZE: 12,
    COMPANY_NAME: 'OMIXIMO'
};

// =============================================================================
// Labels Module
// =============================================================================
const labels = {
    /**
     * Generate a barcode SVG element
     * @param {string} sku - SKU to encode
     * @param {HTMLElement} container - Container element for the barcode
     */
    generateBarcode(sku, container) {
        if (typeof JsBarcode === 'undefined') {
            console.error('JsBarcode library not loaded');
            return;
        }

        JsBarcode(container, sku, {
            format: LABEL_CONFIG.BARCODE_FORMAT,
            width: 2,
            height: LABEL_CONFIG.BARCODE_HEIGHT,
            displayValue: true,
            fontSize: LABEL_CONFIG.FONT_SIZE,
            margin: 5,
            textMargin: 2
        });
    },

    /**
     * Create a single label HTML
     * @param {Object} item - Stock item or part
     * @returns {string} Label HTML
     */
    createLabelHTML(item) {
        const sku = item.IPN || item.sku || `PK-${item.pk}`;
        const name = item.name || 'Unknown Part';
        const price = item.purchase_price || item.price || 0;
        const location = item.location_detail?.name || item.location || '';
        const timestamp = new Date().toLocaleDateString('nl-NL');

        return `
            <div class="label-item">
                <div class="label-header">
                    <span class="label-company">${LABEL_CONFIG.COMPANY_NAME}</span>
                    <span class="label-date">${timestamp}</span>
                </div>
                <div class="label-name">${name}</div>
                <svg class="label-barcode" data-sku="${sku}"></svg>
                <div class="label-footer">
                    <span class="label-location">${location}</span>
                    <span class="label-price">€${parseFloat(price).toFixed(2)}</span>
                </div>
            </div>
        `;
    },

    /**
     * Print a single label
     * @param {Object} item - Stock item or part to print
     */
    printSingle(item) {
        this.printBulk([item]);
    },

    /**
     * Print multiple labels
     * @param {Array} items - Array of stock items or parts
     */
    printBulk(items) {
        // Create print container
        const printContainer = document.createElement('div');
        printContainer.className = 'print-container';
        printContainer.innerHTML = items.map(item => this.createLabelHTML(item)).join('');

        // Add to document temporarily
        document.body.appendChild(printContainer);

        // Generate barcodes
        printContainer.querySelectorAll('.label-barcode').forEach(svg => {
            const sku = svg.dataset.sku;
            this.generateBarcode(sku, svg);
        });

        // Print
        window.print();

        // Cleanup
        setTimeout(() => {
            document.body.removeChild(printContainer);
        }, 1000);
    },

    /**
     * Show print preview modal
     * @param {Array} items - Items to preview
     */
    showPreview(items) {
        const previewHTML = items.map(item => this.createLabelHTML(item)).join('');

        // Create modal
        const modal = document.createElement('div');
        modal.className = 'modal-overlay active';
        modal.id = 'labelPreviewModal';
        modal.innerHTML = `
            <div class="modal label-modal">
                <button class="modal-close" onclick="labels.closePreview()">&times;</button>
                <div class="modal-header">
                    <span class="modal-action">LABEL PREVIEW</span>
                    <h2 class="modal-title">${items.length} Label${items.length > 1 ? 's' : ''}</h2>
                </div>
                <div class="modal-body">
                    <div class="label-preview-container">
                        ${previewHTML}
                    </div>
                    <div class="label-actions">
                        <button class="btn-print" onclick="labels.executePrint()">
                            Print Labels
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Generate barcodes in preview
        modal.querySelectorAll('.label-barcode').forEach(svg => {
            const sku = svg.dataset.sku;
            this.generateBarcode(sku, svg);
        });

        // Store items for print
        this._pendingItems = items;
    },

    /**
     * Execute print from preview
     */
    executePrint() {
        if (this._pendingItems) {
            this.closePreview();
            this.printBulk(this._pendingItems);
            this._pendingItems = null;
        }
    },

    /**
     * Close preview modal
     */
    closePreview() {
        const modal = document.getElementById('labelPreviewModal');
        if (modal) {
            modal.remove();
        }
    },

    /**
     * Print label for a specific location/bin
     * @param {string} locationName - Location identifier (e.g., "A-1-1-A")
     */
    printLocationLabel(locationName) {
        const item = {
            name: locationName,
            IPN: `LOC-${locationName.replace(/-/g, '')}`,
            location: 'Warehouse',
            purchase_price: 0
        };
        this.showPreview([item]);
    }
};

// =============================================================================
// Export for global access
// =============================================================================
window.labels = labels;
