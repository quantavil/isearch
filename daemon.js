#!/usr/bin/env node

const { chromium } = require('playwright');
const net = require('net');
const fs = require('fs');
const { parseHtml } = require('./lib/parser');
const {
  SOCKET_PATH,
  PROFILE_PATH,
  IDLE_TIMEOUT,
  NAV_TIMEOUT,
  AI_WAIT_TIMEOUT,
  CACHE_MAX,
  MAX_CONCURRENT,
  BLOCKED_URLS
} = require('./lib/constants');

const DEBUG = process.env.DEBUG === '1';

// Headless resolution:
//   HEADLESS=false  → headed
//   HEADLESS=true   → headless
//   (unset) + DEBUG → headed  (backward compat)
//   (unset)         → headless (default)
const IS_HEADLESS = process.env.HEADLESS !== undefined
  ? process.env.HEADLESS !== 'false'
  : !DEBUG;

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let browserContext = null;
let browserLaunching = null;
let idleTimer = null;
let server = null;
const cache = new Map();
const startTime = Date.now();

// Concurrency & Pooling
let activeTabs = 0;
const waitQueue = [];
const pagePool = [];
const MAX_POOL_SIZE = MAX_CONCURRENT;

function log(msg) {
  if (DEBUG) console.log(`[${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
}

// ═══════════════════════════════════════════════════════════════
// CONCURRENCY CONTROL
// ═══════════════════════════════════════════════════════════════

function acquireSlot() {
  return new Promise(resolve => {
    if (activeTabs < MAX_CONCURRENT) {
      activeTabs++;
      resolve();
    } else {
      waitQueue.push(resolve);
    }
  });
}

function releaseSlot() {
  if (waitQueue.length > 0) {
    // Transfer slot directly to next waiter
    const next = waitQueue.shift();
    next();
  } else {
    activeTabs--;
  }
}

// ═══════════════════════════════════════════════════════════════
// BROWSER
// ═══════════════════════════════════════════════════════════════

async function initContext() {
  if (browserContext) return browserContext;
  if (browserLaunching) return browserLaunching;

  browserLaunching = (async () => {
    if (!fs.existsSync(PROFILE_PATH)) {
      throw new Error('Profile not found. Run: npm run setup');
    }

    log('Launching browser...');

    const args = [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--disable-background-networking',
      '--disable-backgrounding-occluded-windows',
      '--no-first-run',
      '--disable-notifications',
      '--lang=en-US'
    ];

    try {
      browserContext = await chromium.launchPersistentContext(PROFILE_PATH, {
        headless: IS_HEADLESS,
        args,
        viewport: { width: 1280, height: 800 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      });
      log(`Browser launched (headless: ${IS_HEADLESS})`);
    } catch (e) {
      browserLaunching = null;
      if (e.message.includes('SingletonLock')) {
        throw new Error('Profile locked. Run: ask --stop or pkill -f chromium');
      }
      throw e;
    }

    return browserContext;
  })();

  return browserLaunching;
}



async function getPage() {
  if (pagePool.length > 0) {
    log(`Reusing page from pool (size: ${pagePool.length})`);
    return pagePool.pop();
  }

  const ctx = await initContext();
  const page = await ctx.newPage();

  // Stealth
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // CDP-level resource blocking (faster than route-based)
  try {
    const client = await ctx.newCDPSession(page);
    await client.send('Network.setBlockedURLs', { urls: BLOCKED_URLS });
    await client.send('Network.enable');
  } catch (e) {
    log(`CDP warning: ${e.message}`);
  }

  return page;
}

// ═══════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════

async function search(query) {
  const cacheKey = query.toLowerCase().trim();
  const t0 = Date.now();

  // Cache check (before acquiring a tab slot)
  if (cache.has(cacheKey)) {
    log(`Cache hit: "${query}"`);
    const cached = cache.get(cacheKey);
    // LRU refresh
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return { markdown: cached, fromCache: true, timeMs: Date.now() - t0 };
  }

  await acquireSlot();
  let page = null;

  try {
    page = await getPage();

    // Navigate
    await page.goto(`https://www.google.com/search?udm=50&q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT
    });

    // CAPTCHA check
    if (await page.$('form[action*="Captcha"], #captcha-form, #recaptcha')) {
      throw new Error("CAPTCHA detected. Run 'npm run setup' to solve.");
    }

    // Wait for AI completion
    try {
      await page.waitForSelector('[data-container-id="main-col"]', { timeout: 3000 });

      await Promise.race([
        page.waitForSelector('svg[viewBox="3 3 18 18"]', { timeout: AI_WAIT_TIMEOUT }),
        page.waitForFunction(() => {
          const el = document.querySelector('[data-container-id="main-col"]');
          return el && el.textContent.length > 500;
        }, { timeout: AI_WAIT_TIMEOUT })
      ]);
    } catch {
      log('AI wait timeout (using available content)');
    }

    // Parse
    let html;
    try {
      html = await page.$eval('[data-container-id="main-col"]', el => el.outerHTML);
    } catch {
      html = await page.content(); // Fallback to full content if specific selector fails
    }
    const markdown = parseHtml(html);

    if (!markdown) {
      throw new Error('Failed to parse content.');
    }

    // Cache (LRU eviction)
    cache.set(cacheKey, markdown);
    if (cache.size > CACHE_MAX) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }

    const timeMs = Date.now() - t0;
    log(`"${query}" done in ${timeMs}ms`);

    return { markdown, fromCache: false, timeMs };

  } catch (err) {
    log(`Error: ${err.message}`);
    return { error: err.message, timeMs: Date.now() - t0 };
  } finally {
    if (page) {
      if (pagePool.length < MAX_POOL_SIZE) {
        log('Returning page to pool');
        pagePool.push(page);
      } else {
        await page.close().catch(() => { });
      }
    }
    releaseSlot();
  }
}

// ═══════════════════════════════════════════════════════════════
// REQUEST HANDLER
// ═══════════════════════════════════════════════════════════════

async function handleRequest(data) {
  resetIdleTimer();

  if (!data || typeof data.query !== 'string') {
    return { error: 'Invalid request' };
  }

  const q = data.query;

  if (q === '__STOP__') {
    setImmediate(shutdown);
    return { stopped: true };
  }

  if (q === '__STATUS__') {
    return {
      status: 'running',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      cacheSize: cache.size,
      browser: browserContext ? 'connected' : 'initializing',
      headless: IS_HEADLESS
    };
  }

  return await search(q);
}

// ═══════════════════════════════════════════════════════════════
// SERVER
// ═══════════════════════════════════════════════════════════════

function startServer() {
  try { fs.unlinkSync(SOCKET_PATH); } catch { }

  server = net.createServer(socket => {
    let buffer = '';
    let processing = false;

    socket.on('data', async chunk => {
      buffer += chunk;
      if (processing) return;

      const idx = buffer.indexOf('\n');
      if (idx === -1) return;

      processing = true;
      const msg = buffer.slice(0, idx);

      try {
        const req = JSON.parse(msg);
        const res = await handleRequest(req);
        socket.write(JSON.stringify(res) + '\n');
      } catch {
        socket.write(JSON.stringify({ error: 'Internal error' }) + '\n');
      }
      socket.end();
    });

    socket.on('error', () => { });
  });

  server.listen(SOCKET_PATH, () => {
    log(`Listening on ${SOCKET_PATH} (headless: ${IS_HEADLESS})`);
    resetIdleTimer();
    initContext().catch(e => log(`Warmup: ${e.message}`));
  });

  server.on('error', e => {
    console.error(`Server error: ${e.message}`);
    process.exit(1);
  });
}

async function shutdown() {
  log('Shutting down...');
  if (idleTimer) clearTimeout(idleTimer);
  if (browserContext) await browserContext.close().catch(() => { });
  if (server) server.close();
  try { fs.unlinkSync(SOCKET_PATH); } catch { }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', async e => {
  console.error('Fatal:', e);
  try { if (browserContext) await browserContext.close().catch(() => { }); } catch { }
  try { if (server) server.close(); } catch { }
  try { fs.unlinkSync(SOCKET_PATH); } catch { }
  process.exit(1);
});

startServer();