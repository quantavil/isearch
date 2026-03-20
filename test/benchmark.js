const net = require('net');
const os = require('os');
const path = require('path');

const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock');

function sendRequest(query) {
    return new Promise((resolve, reject) => {
        const client = net.createConnection({ path: SOCKET_PATH }, () => {
            client.write(JSON.stringify({ query }) + '\n');
        });

        let buffer = '';
        client.on('data', (data) => {
            buffer += data.toString();
            if (buffer.endsWith('\n')) {
                try {
                    const response = JSON.parse(buffer.trim());
                    resolve(response);
                } catch (e) {
                    reject(e);
                }
                client.end();
            }
        });

        client.on('error', (err) => {
            reject(err);
        });
    });
}

async function runBenchmark() {
    console.log('Starting benchmark...');
    const query = 'test query ' + Date.now(); // Unique query to avoid cache
    const iterations = 5;
    const times = [];

    // Warmup
    console.log('Warmup request...');
    try {
        await sendRequest(query);
    } catch (e) {
        console.error('Benchmark failed (warmup):', e.message);
        process.exit(1);
    }

    // Measured runs
    for (let i = 0; i < iterations; i++) {
        process.stdout.write(`Iteration ${i + 1}/${iterations}... `);
        const start = Date.now();
        try {
            // Use a slight variation to bypass cache if needed, but for now let's test uncached performance
            // Actually, the daemon caches by query string. To test raw search speed, we need unique queries.
            const uniqueQuery = `benchmark test query ${Date.now()} ${i}`;
            const res = await sendRequest(uniqueQuery);
            if (res.error) throw new Error(res.error);
            const duration = res.timeMs || (Date.now() - start);
            times.push(duration);
            console.log(`${duration}ms`);
        } catch (e) {
            console.log(`Error: ${e.message}`);
        }
    }

    if (times.length === 0) {
        console.log('No successful measurements.');
        return;
    }

    const min = Math.min(...times);
    const max = Math.max(...times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    // Median
    times.sort((a, b) => a - b);
    const mid = Math.floor(times.length / 2);
    const median = times.length % 2 !== 0 ? times[mid] : (times[mid - 1] + times[mid]) / 2;

    console.log('\n--- Results ---');
    console.log(`Min: ${min}ms`);
    console.log(`Max: ${max}ms`);
    console.log(`Avg: ${avg.toFixed(2)}ms`);
    console.log(`Median: ${median}ms`);
}

runBenchmark();
