const CONFIG = {
    API_BASE: 'http://localhost:8000/api',
    USER: 'admin',
    PASS: 'admin'
};

async function run() {
    console.log('🚀 Starting Pagination Verification...');

    // 1. Authenticate
    const authRes = await fetch(`${CONFIG.API_BASE}/user/token/`, {
        headers: { 'Authorization': 'Basic ' + (Buffer.from(`${CONFIG.USER}:${CONFIG.PASS}`).toString('base64')) }
    });
    const { token } = await authRes.json();
    const headers = { 'Authorization': `Token ${token}` };

    // 2. Test Limit/Offset
    console.log('\n📄 Testing Limit 10, Offset 0...');
    const page1Res = await fetch(`${CONFIG.API_BASE}/part/?limit=10&offset=0`, { headers });
    const page1 = await page1Res.json();

    console.log('Page 1 Count:', page1.count);
    console.log('Page 1 Results:', page1.results.length);
    console.log('Page 1 First ID:', page1.results[0]?.pk);
    const firstId = page1.results[0]?.pk;

    console.log('\n📄 Testing Limit 10, Offset 10...');
    const page2Res = await fetch(`${CONFIG.API_BASE}/part/?limit=10&offset=10`, { headers });
    const page2 = await page2Res.json();

    console.log('Page 2 Results:', page2.results.length);
    console.log('Page 2 First ID:', page2.results[0]?.pk);

    if (firstId === page2.results[0]?.pk) {
        console.error('❌ FAIL: Page 1 and Page 2 start with same ID!');
        process.exit(1);
    } else {
        console.log('✅ PASS: Pagination is working (IDs differ).');
    }

    // 3. Test In-Stock Field availability
    const part = page1.results[0];
    if (part.in_stock === undefined) {
        console.error('❌ FAIL: in_stock field missing!');
        process.exit(1);
    } else {
        console.log('✅ PASS: in_stock field present.');
    }
}

run().catch(console.error);
