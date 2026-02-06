#!/usr/bin/env node

const { chromium } = require('playwright');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const turndownPluginGfm = require('turndown-plugin-gfm');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const IDLE_TIMEOUT = 300_000;         // 5 min auto-shutdown
const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock');
const PROFILE_PATH = path.join(os.homedir(), '.google-search-cli', 'profile');
const DEBUG = process.env.DEBUG === '1';

const NAV_TIMEOUT = 12000;
const AI_WAIT_TIMEOUT = 8000;
const POOL_SIZE = 2;
const CACHE_MAX = 50;

// CDP Blocked URLs (applied per page)
const BLOCKED_URLS = [
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.svg',
  '*.woff', '*.woff2', '*.ttf', '*.otf',
  '*.mp4', '*.webm', '*.mp3', '*.wav',
  '*doubleclick*', '*google-analytics*', '*googlesyndication*',
  '*googleadservices*', '*facebook*', '*twitter*', '*linkedin*'
];

// ═══════════════════════════════════════════════════════════════
// TURNDOWN (HTML → Markdown)
// ═══════════════════════════════════════════════════════════════

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  hr: '---'
});

turndown.use(turndownPluginGfm.gfm);

// Single rule to strip links (keeps text)
turndown.addRule('stripLinks', { 
  filter: 'a', 
  replacement: content => content 
});

// Remove all non-text elements
turndown.addRule('removeNonText', { 
  filter: ['img', 'svg', 'canvas', 'video', 'audio', 'button', 'input', 
           'form', 'nav', 'footer', 'header', 'iframe', 'script', 'style'],
  replacement: () => '' 
});

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let browserContext = null;
let idleTimer = null;
let server = null;
let isShuttingDown = false;
const cache = new Map();
const pagePool = [];
let warmingPool = false;
const startTime = Date.now();

function log(msg) {
  if (DEBUG) {
    const ts = new Date().toISOString().slice(11, 23);
    console.log(`[${ts}] ${msg}`);
  }
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    log('Idle timeout reached');
    shutdown();
  }, IDLE_TIMEOUT);
}

// ═══════════════════════════════════════════════════════════════
// BROWSER MANAGEMENT
// ═══════════════════════════════════════════════════════════════

async function initContext() {
  if (browserContext) return browserContext;

  if (!fs.existsSync(PROFILE_PATH)) {
    throw new Error('Profile not found. Run: npm run setup');
  }

  log('Launching persistent browser context...');

  const launchArgs = [
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
    '--disable-renderer-backgrounding',
    '--no-first-run',
    '--disable-notifications',
    '--lang=en-US'
  ];

  try {
    browserContext = await chromium.launchPersistentContext(PROFILE_PATH, {
      headless: !DEBUG,
      args: launchArgs,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      bypassCSP: true,
      ignoreHTTPSErrors: true
    });

    log('Browser context launched successfully');
    
    // Start warming the pool immediately
    warmPool();
    
    return browserContext;

  } catch (e) {
    if (e.message.includes('SingletonLock')) {
      throw new Error('Profile is locked. Run: ask --stop, or: pkill -f chromium');
    }
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════
// PAGE POOL (Real Tab Pooling with CDP per-page)
// ═══════════════════════════════════════════════════════════════

async function createOptimizedPage() {
  const ctx = await initContext();
  const page = await ctx.newPage();

  // 1. Stealth scripts
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    window.chrome = { runtime: {} };
  });

  // 2. CDP-level blocking (per page, but done once at creation)
  try {
    const client = await ctx.newCDPSession(page);
    await client.send('Network.setBlockedURLs', { urls: BLOCKED_URLS });
    await client.send('Network.enable');
    
    // Store CDP client reference for potential future use
    page._cdpClient = client;
  } catch (e) {
    log(`CDP setup warning: ${e.message}`);
  }

  return page;
}

async function warmPool() {
  if (warmingPool || isShuttingDown) return;
  warmingPool = true;

  try {
    while (pagePool.length < POOL_SIZE && !isShuttingDown) {
      const page = await createOptimizedPage();
      if (!isShuttingDown) {
        pagePool.push(page);
        log(`Pool warmed: ${pagePool.length}/${POOL_SIZE} pages`);
      } else {
        await page.close().catch(() => {});
      }
    }
  } catch (e) {
    log(`Pool warmup error: ${e.message}`);
  } finally {
    warmingPool = false;
  }
}

async function acquirePage() {
  await initContext();

  // Try to get from pool
  if (pagePool.length > 0) {
    const page = pagePool.shift();
    
    // Verify page is still usable
    try {
      if (!page.isClosed()) {
        // Trigger async replenish
        setImmediate(() => warmPool());
        return page;
      }
    } catch {
      // Page invalid, fall through to create new
    }
  }

  // Pool empty or page invalid - create new
  log('Pool empty, creating new page');
  return await createOptimizedPage();
}

function releasePage(page) {
  if (!page || isShuttingDown) return;

  try {
    if (page.isClosed()) return;

    if (pagePool.length < POOL_SIZE) {
      // Return to pool - no navigation needed, just reuse
      pagePool.push(page);
      log(`Page returned to pool: ${pagePool.length}/${POOL_SIZE}`);
    } else {
      // Pool full, close this page
      page.close().catch(() => {});
    }
  } catch {
    // Page in bad state, try to close
    page.close().catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════
// SEARCH LOGIC
// ═══════════════════════════════════════════════════════════════

async function search(query) {
  const cacheKey = query.toLowerCase().trim();
  const searchStart = Date.now();

  // 1. Check cache first
  if (cache.has(cacheKey)) {
    log(`Cache hit: "${query}"`);
    const cached = cache.get(cacheKey);
    // Move to end (LRU refresh)
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return { 
      markdown: cached, 
      fromCache: true, 
      timeMs: Date.now() - searchStart 
    };
  }

  let page = null;

  try {
    page = await acquirePage();
    const navStart = Date.now();

    // 2. Navigate
    const url = `https://www.google.com/search?udm=50&q=${encodeURIComponent(query)}`;
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT
    });

    log(`Navigation: ${Date.now() - navStart}ms`);

    // 3. CAPTCHA check
    const hasCaptcha = await page.$('form[action*="Captcha"], #captcha-form, #recaptcha');
    if (hasCaptcha) {
      throw new Error("CAPTCHA detected. Run 'npm run setup' to solve manually.");
    }

    // 4. Wait for AI result
    const waitStart = Date.now();
    try {
      await page.waitForSelector('[data-container-id="main-col"]', { timeout: 4000 });
      
      // Wait for completion indicators
      await Promise.race([
        page.waitForSelector('svg[viewBox="3 3 18 18"]', { timeout: AI_WAIT_TIMEOUT }),
        page.waitForFunction(() => {
          const el = document.querySelector('[data-container-id="main-col"]');
          return el && el.textContent && el.textContent.length > 300;
        }, { timeout: AI_WAIT_TIMEOUT }),
        new Promise(r => setTimeout(r, AI_WAIT_TIMEOUT))
      ]);
    } catch {
      log(`AI wait: ${Date.now() - waitStart}ms (timeout/not found)`);
    }

    // 5. Extract and parse
    const html = await page.content();
    const markdown = parseHtml(html);

    if (!markdown || markdown.length < 20) {
      throw new Error('Failed to parse content. Page structure may have changed.');
    }

    // 6. Update cache (LRU eviction)
    cache.set(cacheKey, markdown);
    while (cache.size > CACHE_MAX) {
      const firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }

    const timeMs = Date.now() - searchStart;
    log(`Search complete: "${query}" in ${timeMs}ms`);

    return { markdown, fromCache: false, timeMs };

  } catch (err) {
    log(`Search error: ${err.message}`);
    return { 
      error: err.message, 
      timeMs: Date.now() - searchStart 
    };
  } finally {
    releasePage(page);
  }
}

function parseHtml(html) {
  const $ = cheerio.load(html);
  const $container = $('[data-container-id="main-col"]').first();

  if (!$container.length) {
    return null;
  }

  // Remove unwanted elements
  $container.find([
    'script', 'style', 'noscript', 'iframe',
    '[data-ved]', '[aria-label="Helpful"]', '[aria-label="Not helpful"]',
    '[aria-label*="Share"]', '[aria-label="More"]',
    'g-loading-icon', '.loading'
  ].join(',')).remove();

  // Remove "Generative AI is experimental" disclaimer
  $container.find('*').each((_, el) => {
    const text = $(el).text().trim();
    if (text === 'Generative AI is experimental.' || 
        text.startsWith('Thinking') || 
        text.startsWith('Generating')) {
      $(el).remove();
    }
  });

  const cleanHtml = $container.html();
  if (!cleanHtml) return null;

  let md = turndown.turndown(cleanHtml);

  // Minimal post-processing (most done by Turndown rules)
  md = md
    .replace(/\n{3,}/g, '\n\n')    // Collapse 3+ newlines to 2
    .replace(/^\s+|\s+$/g, '');     // Trim

  return md;
}

// ═══════════════════════════════════════════════════════════════
// REQUEST HANDLER
// ═══════════════════════════════════════════════════════════════

async function handleRequest(data) {
  resetIdleTimer();

  if (!data || typeof data.query !== 'string') {
    return { error: 'Invalid request: missing query' };
  }

  const query = data.query;

  // Control commands
  if (query === '__STOP__') {
    setImmediate(() => shutdown());
    return { stopped: true };
  }

  if (query === '__STATUS__') {
    return {
      status: 'running',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      cacheSize: cache.size,
      poolSize: pagePool.length,
      poolMax: POOL_SIZE,
      browser: browserContext ? 'connected' : 'initializing'
    };
  }

  // Regular search
  return await search(query);
}

// ═══════════════════════════════════════════════════════════════
// SERVER
// ═══════════════════════════════════════════════════════════════

function startServer() {
  // Clean up stale socket
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      log(`Socket cleanup warning: ${e.message}`);
    }
  }

  server = net.createServer(socket => {
    let buffer = '';

    socket.on('data', async chunk => {
      buffer += chunk.toString();

      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) return;

      const message = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);

      try {
        const request = JSON.parse(message);
        const response = await handleRequest(request);
        socket.write(JSON.stringify(response));
      } catch (e) {
        socket.write(JSON.stringify({ error: `Server error: ${e.message}` }));
      } finally {
        socket.end();
      }
    });

    socket.on('error', err => {
      log(`Socket error: ${err.message}`);
    });
  });

  server.on('error', err => {
    console.error(`Server failed to start: ${err.message}`);
    process.exit(1);
  });

  server.listen(SOCKET_PATH, () => {
    log(`Daemon listening on ${SOCKET_PATH}`);
    resetIdleTimer();

    // Pre-warm browser context
    initContext().catch(e => {
      log(`Browser init error: ${e.message}`);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// SHUTDOWN
// ═══════════════════════════════════════════════════════════════

async function shutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  log('Shutting down...');

  // Clear timer
  if (idleTimer) clearTimeout(idleTimer);

  // Close pooled pages
  for (const page of pagePool) {
    await page.close().catch(() => {});
  }
  pagePool.length = 0;

  // Close browser
  if (browserContext) {
    await browserContext.close().catch(() => {});
    browserContext = null;
  }

  // Close server
  if (server) {
    server.close();
  }

  // Remove socket file
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch {}

  log('Shutdown complete');
  process.exit(0);
}

// Signal handlers
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', err => {
  console.error('Uncaught exception:', err);
  shutdown();
});
process.on('unhandledRejection', err => {
  console.error('Unhandled rejection:', err);
  shutdown();
});

// Start the server
startServer();