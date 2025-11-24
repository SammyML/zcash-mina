
const http = require('http');

function request(path, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 8791,
            path: path,
            method: method,
            headers: {
                'Content-Type': 'application/json',
            },
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data });
                }
            });
        });

        req.on('error', (e) => {
            reject(e);
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function runTests() {
    try {
        console.log('Testing /api/status...');
        const status = await request('/api/status');
        console.log('Status:', status.status);
        console.log('Data:', JSON.stringify(status.data, null, 2));

        if (status.status !== 200) throw new Error('Status check failed');

        console.log('\nTesting /api/mint...');
        const mint = await request('/api/mint', 'POST', { recipient: 'user1', amount: 1.0 });
        console.log('Status:', mint.status);
        console.log('Data:', JSON.stringify(mint.data, null, 2));

        if (mint.status !== 200) throw new Error('Mint failed');

        console.log('\nTesting /api/burn...');
        const burn = await request('/api/burn', 'POST', { burner: 'user1', amount: 0.5, zcashAddress: 'zs1test' });
        console.log('Status:', burn.status);
        console.log('Data:', JSON.stringify(burn.data, null, 2));

        if (burn.status !== 200) throw new Error('Burn failed');

        console.log('\nAll tests passed!');
    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

runTests();
