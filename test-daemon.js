#!/usr/bin/env node

const path = require('path');
const { search, status, stop, startDaemon } = require(path.join(__dirname, 'lib', 'client'));
const { SOCKET_PATH } = require(path.join(__dirname, 'lib', 'constants'));

// Colors
const c = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  dim: '\x1b[2m'
};

async function runTests() {
  console.log('\n🧪 iSearch Integration Tests\n');
  console.log(`${c.dim}Socket: ${SOCKET_PATH}${c.reset}\n`);

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      const start = Date.now();
      await fn();
      const duration = Date.now() - start;
      console.log(`${c.green}✔${c.reset} ${name} ${c.dim}(${duration}ms)${c.reset}`);
      passed++;
    } catch (err) {
      console.log(`${c.red}✖${c.reset} ${name}`);
      console.log(`  ${c.red}${err.message}${c.reset}`);
      failed++;
    }
  }

  // Test 1: Start daemon (or connect to existing)
  await test('Daemon startup/connection', async () => {
    try {
      await status();
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') {
        console.log(`  ${c.dim}Starting daemon...${c.reset}`);
        await startDaemon();
      } else {
        throw e;
      }
    }
  });

  // Test 2: Status check
  await test('Status endpoint', async () => {
    const result = await status();
    if (result.status !== 'running') throw new Error('Expected status "running"');
    if (typeof result.uptime !== 'number') throw new Error('Expected numeric uptime');
    if (typeof result.cacheSize !== 'number') throw new Error('Expected numeric cacheSize');
    if (typeof result.headless !== 'boolean') throw new Error('Expected boolean headless');
  });

  // Test 3: Simple search
  await test('Basic search query', async () => {
    const result = await search('capital of France');
    if (result.error) throw new Error(result.error);
    if (!result.markdown) throw new Error('No markdown content');
    if (!result.markdown.toLowerCase().includes('paris')) {
      throw new Error('Expected "Paris" in results');
    }
    console.log(`  ${c.dim}Time: ${result.timeMs}ms, Cached: ${result.fromCache}${c.reset}`);
  });

  // Test 4: Cache hit
  await test('Cache hit on repeat query', async () => {
    const result = await search('capital of France');
    if (!result.fromCache) throw new Error('Expected cache hit');
    if (result.timeMs > 50) throw new Error(`Cache should be fast, got ${result.timeMs}ms`);
  });

  // Test 5: Different query
  await test('Different search query', async () => {
    const result = await search('what is Node.js');
    if (result.error) throw new Error(result.error);
    if (!result.markdown) throw new Error('No markdown content');
    console.log(`  ${c.dim}Content length: ${result.markdown.length} chars${c.reset}`);
  });

  // Test 6: Cache populated
  await test('Cache populated after searches', async () => {
    const result = await status();
    if (result.cacheSize < 1) {
      console.log(`  ${c.yellow}Warning: Cache empty${c.reset}`);
    }
  });

  // Summary
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`Results: ${c.green}${passed} passed${c.reset}, ${failed > 0 ? c.red : c.dim}${failed} failed${c.reset}`);

  if (process.argv.includes('--stop')) {
    console.log(`\n${c.dim}Stopping daemon...${c.reset}`);
    await stop().catch(() => {});
    console.log('Daemon stopped.\n');
  } else {
    console.log(`\n${c.dim}Daemon left running. Use --stop to shut down.${c.reset}\n`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error(`\n${c.red}Test runner crashed:${c.reset}`, err);
  process.exit(1);
});