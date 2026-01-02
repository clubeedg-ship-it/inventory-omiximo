const CONFIG = {
    API_BASE: 'http://localhost:8000/api',
    USER: 'admin',
    PASS: 'admin'
};

async function run() {
    console.log('🚀 Starting Benchmark...');

    // 1. Authenticate
    console.log('🔑 Authenticating...');
    const authRes = await fetch(`${CONFIG.API_BASE}/user/token/`, {
        headers: { 'Authorization': 'Basic ' + (Buffer.from(`${CONFIG.USER}:${CONFIG.PASS}`).toString('base64')) }
    });

    if (!authRes.ok) {
        console.error('Auth failed:', authRes.status);
        process.exit(1);
    }
    const { token } = await authRes.json();
    console.log('✓ Token received');
    const headers = { 'Authorization': `Token ${token}` };

    // 2. Analyze Part Structure
    console.log('\n📦 Fetching 1 Part...');
    const partsRes = await fetch(`${CONFIG.API_BASE}/part/?limit=1`, { headers });
    const partsData = await partsRes.json();
    const part = partsData.results[0];

    if (part) {
        console.log('Part Keys:', Object.keys(part).join(', '));
        console.log('Part.in_stock:', part.in_stock);
        console.log('Part.minimum_stock:', part.minimum_stock);
    } else {
        console.warn('No parts found');
    }

    // 3. Analyze Stock Structure
    console.log('\n🏭 Fetching 1 Stock Item...');
    const stockRes = await fetch(`${CONFIG.API_BASE}/stock/?limit=1`, { headers });
    const stockData = await stockRes.json();
    const item = stockData.results[0];

    if (item) {
        console.log('Stock Keys:', Object.keys(item).join(', '));
        console.log('Stock.part_detail:', JSON.stringify(item.part_detail, null, 2));
    } else {
        console.warn('No stock found');
    }

    // 4. Benchmark limit=50 vs limit=500
    console.log('\n⏱️ Benchmarking...');

    const start50 = performance.now();
    await fetch(`${CONFIG.API_BASE}/part/?limit=50`, { headers });
    const end50 = performance.now();
    console.log(`Fetch 50 parts: ${(end50 - start50).toFixed(2)}ms`);

    const start500 = performance.now();
    await fetch(`${CONFIG.API_BASE}/part/?limit=500`, { headers });
    const end500 = performance.now();
    console.log(`Fetch 500 parts: ${(end500 - start500).toFixed(2)}ms`); // Baseline
}

run().catch(console.error);
