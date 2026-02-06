#!/usr/bin/env node
const { search, closeBrowser } = require('./daemon.js');

(async () => {
    console.log('Test starting...');
    const t0 = Date.now();
    try {
        const result = await search('capital of france');
        console.log('Time:', Date.now() - t0, 'ms');
        console.log('Has markdown:', !!result.markdown);
        console.log('Preview:', result.markdown?.substring(0, 150) || 'none');
    } catch (e) {
        console.log('Error:', e.message);
    }
    await closeBrowser().catch(() => { });
    process.exit(0);
})();
