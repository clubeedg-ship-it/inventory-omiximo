# Omiximo Inventory OS - Comprehensive Developer Handoff

**Version:** 0.8.0 (Alpha)
**Date:** January 1, 2026
**Backend:** InvenTree (Django/Python)
**Frontend:** Vanilla JS / HTML5 (Headless SPA)

---

## 🚀 Application Purpose & Vision
**"Omiximo Inventory OS"** is a high-performance, keyboard-first inventory management system designed for a computer assembly business. It totally replaces the default InvenTree UI with a "Headless" Single Page Application (SPA).

**Core Philosophy:**
1.  **Speed is Feature #1:** Zero build steps, instant load times, raw WebSocket updates.
2.  **Swiss Sci-Fi Aesthetic:** A "Braun electronics from 2077" look—deep teal (`#005066`), glassmorphism, and strict grid alignments.
3.  **Hardware First:** Optimized for NetumScan barcode scanners (Keyboard Wedge mode).

---

## 🏗 System Architecture

### 1. The Headless Frontend (`/frontend`)
*   **No Frameworks:** Built purely in ES6+ JavaScript. No React, No Vue, No Webpack complexity.
*   **Routing:** Custom hash-based router (`app.js`) handling views (`#scanner`, `#wall`, `#profit`).
*   **State Management:**
    *   `router`: Handles navigation and authentication state.
    *   `profitState`: Manages transaction history and inventory valuation logic.
    *   `localStorage`: Used for persisting views and cached transaction data (`omiximo_transactions`).

### 2. The Backend (InvenTree)
*   **API-Only:** We utilize InvenTree solely as a database and logic engine via its REST API (`/api/v1/`).
*   **Dockerized:** Runs in a container stack (`inventree-server`, `inventree-db`, `redis`, `inventree-worker`).
*   **Database:** PostgreSQL (persistent volumes stored in `./data`).

---

## 📦 Current Features & Pages

### 1. The Wall (Home View)
*   **Purpose:** Instant visual feedback of stock levels.
*   **UI:** An 8x7 rigid grid representing physical storage bins.
*   **Logic:**
    *   Real-time polling of InvenTree stock levels.
    *   Visual indicators (Green/Red/Orange) for stock health.

### 2. The Scanner (Barcode Action Center)
*   **Purpose:** Rapid-fire check-in/check-out of parts using a hardware scanner.
*   **Logic:**
    *   **Global Listener:** Intercepts scanner input (rapid keystrokes ending in Enter) anywhere in the app.
    *   **Intelligent Parsing:** Auto-detects if a barcode is a Part, Stock Location, or Command.
    *   **Batch Management:** Automatically handles FIFO (First-In-First-Out) rotation for stock consumption.

### 3. Profitability Engine (Financial Dashboard)
*   **Purpose:** Real-time tracking of margins, costs, and inventory value.
*   **Key Features:**
    *   **Logic:** Calculates "True Profit" by tracking exactly which batch was sold (FIFO cost basis), ensuring old (cheaper) stock is accounted for correctly against new (expensive) stock.
    *   **Charts:** Interactive Chart.js line graph showing profit trends (Day/Week/Month/Year).
    *   **Inventory Value:** Real-time valuation of all current stock (drill-down available).
    *   **Cash Flow:** Switchable view for Daily vs. Monthly cash flow.

### 4. Tenant & Label Printing
*   **Purpose:** Multi-tenant support and label printing.
*   **Current State:** Basic structure in `tenant.js` and `labels.js`.

### 5. Recent Fixes (Jan 2026)
*   **Inventory Valuation:** Fixed critical bug where inventory value was €0.00. Now uses client-side joining (`state.parts`) to robustly calculate value from stock batches.
*   **Batch Editing:** Resolved issue where batch renders were empty; confirmed edits to quantity/price save correctly.
*   **Browser Caching:** Implemented strictly versioned script tags (`v=5`) in `index.html` to prevent stale code issues.

---

## 🛠 Development State & Files

| File | Purpose | Key Methods |
| :--- | :--- | :--- |
| **`index.html`** | Single entry point. Contains all view templates (hidden by default). | N/A |
| **`app.js`** | Core router, Auth, and Global Scanner Listener. | `router.init()`, `handleBarcode()`, `restoreSavedView()` |
| **`profit.js`** | **Critical Logic.** Handles FIFO calculations, Chart.js rendering, and Inventory Valuation. | `profitEngine.renderChart()`, `calculateFifoCost()`, `renderInventoryBreakdown()` |
| **`style.css`** | 1,400+ lines of custom CSS. Handles all "Swiss Sci-Fi" glassmorphism and grid layouts. | `.glass`, `.grid-layout`, `#view-profit` |
| **`refresh.sh`** | Helper script to rebuild Docker containers without losing data. | `./refresh.sh --frontend` (fast build) |

---

## 🔮 Future Roadmap & Potential Improvements

### A. Critical "Next Steps" (Immediate)
1.  **Persist Profit Data:** Currently, sales transactions are stored in `localStorage`. They need to be pushed to an InvenTree custom model or a separate "Sales" API endpoint for permanent storage.
2.  **Label Printing Integration:** Connect `labels.js` to a real ZPL/Brother printer driver or InvenTree's label plugin.

### B. Feature Requests (Backlog)
1.  **Supplier Integration:** Auto-generate Purchase Orders (POs) when "The Wall" shows red bins.
2.  **User Permissions:** Restrict "Profitability Engine" access to Admin users only.
3.  **Detailed Batch Tracking:** Add a "Timeline" view for a specific batch to see its entire lifecycle (Purchase -> Move -> Sale).

### C. Known Bugs / Debugging Areas
1.  **Scanner Focus:** Occasionally, if an input field is explicitly focused, the global scanner listener might duplicate characters.
2.  **Chart Data Load:** If `localStorage` is cleared, valid historical profit data is lost. **High Priority fix needed (Database persistence).**

---

### ⚡ Quick Start for New Devs
1.  **Start System:** `docker-compose up -d`
2.  **Frontend Refresh:** `./refresh.sh --frontend`
3.  **Access:** `http://localhost:1441`
4.  **Simulate Scanner:** Type rapidly on your keyboard and hit Enter (e.g., `PART-123<Enter>`).
