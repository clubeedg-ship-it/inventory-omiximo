const CONFIG = {
    API_BASE: 'http://localhost:8000/api',
    USER: 'admin',
    PASS: 'admin'
};

async function run() {
    console.log('🚀 Seeding Parts...');

    // 1. Authenticate
    const authRes = await fetch(`${CONFIG.API_BASE}/user/token/`, {
        headers: { 'Authorization': 'Basic ' + (Buffer.from(`${CONFIG.USER}:${CONFIG.PASS}`).toString('base64')) }
    });
    const { token } = await authRes.json();
    const headers = {
        'Authorization': `Token ${token}`,
        'Content-Type': 'application/json'
    };

    // 2. Create Parts
    for (let i = 1; i <= 50; i++) {
        const payload = {
            name: `Performance Part ${i.toString().padStart(3, '0')}`,
            description: `Auto-generated for scalability testing`,
            category: 1, // Assumes category 1 exists
            active: true,
            component: true,
            purchaseable: true,
            minimum_stock: 10
        };

        try {
            const res = await fetch(`${CONFIG.API_BASE}/part/`, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                process.stdout.write('.');
            } else {
                process.stdout.write('x');
            }
        } catch (e) {
            process.stdout.write('E');
        }
    }
    console.log('\n✓ Seeding complete');
}

run().catch(console.error);
