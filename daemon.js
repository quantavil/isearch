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

const IDLE_TIMEOUT = 300_000;
const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock');
const PROFILE_PATH = path.join(os.homedir(), '.google-search-cli', 'profile');
const DEBUG = process.env.DEBUG === '1';

const NAV_TIMEOUT = 15000;
const AI_WAIT_TIMEOUT = 10000;
const CACHE_MAX = 50;

// ═══════════════════════════════════════════════════════════════
// TURNDOWN
// ═══════════════════════════════════════════════════════════════

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  hr: '---'
});

turndown.use(turndownPluginGfm.gfm);
turndown.addRule('stripLinks', { filter: 'a', replacement: c => c });
turndown.addRule('removeMedia', { 
  filter: ['img', 'svg', 'canvas', 'video', 'audio'], 
  replacement: () => '' 
});
turndown.addRule('removeInteractive', { 
  filter: ['button', 'input', 'form', 'nav', 'footer', 'header'], 
  replacement: () => '' 
});

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let browserContext = null;
let idleTimer = null;
let server = null;
const cache = new Map();
const startTime = Date.now();

function log(msg) {
  if (DEBUG) console.log(`[${new Date().toISOString().slice(11, 23)}] ${msg}`);
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
}

// ═══════════════════════════════════════════════════════════════
// BROWSER
// ═══════════════════════════════════════════════════════════════

async function initContext() {
  if (browserContext) return browserContext;

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
      headless: !DEBUG,
      args,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    });
    log('Browser launched');
  } catch (e) {
    if (e.message.includes('SingletonLock')) {
      throw new Error('Profile locked. Run: ask --stop or pkill -f chromium');
    }
    throw e;
  }

  return browserContext;
}

async function getPage() {
  const ctx = await initContext();
  const page = await ctx.newPage();

  // Stealth
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // CDP blocking
  try {
    const client = await ctx.newCDPSession(page);
    await client.send('Network.setBlockedURLs', {
      urls: [
        '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.svg',
        '*.woff', '*.woff2', '*.ttf', '*.otf',
        '*.mp4', '*.webm', '*.mp3',
        '*doubleclick*', '*google-analytics*', '*googlesyndication*',
        '*googleadservices*', '*facebook*', '*twitter*', '*linkedin*'
      ]
    });
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

  // Cache check
  if (cache.has(cacheKey)) {
    log(`Cache hit: "${query}"`);
    const cached = cache.get(cacheKey);
    // LRU refresh
    cache.delete(cacheKey);
    cache.set(cacheKey, cached);
    return { markdown: cached, fromCache: true, timeMs: Date.now() - t0 };
  }

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

    // Wait for AI (fast heuristic)
    try {
      await page.waitForSelector('[data-container-id="main-col"]', { timeout: 5000 });
      await page.waitForSelector('svg[viewBox="3 3 18 18"]', { timeout: AI_WAIT_TIMEOUT });
    } catch {
      log('AI wait timeout (using available content)');
    }

    // Parse
    const html = await page.content();
    const markdown = parseHtml(html);

    if (!markdown) {
      throw new Error('Failed to parse content.');
    }

    // Cache (LRU)
    cache.set(cacheKey, markdown);
    while (cache.size > CACHE_MAX) {
      cache.delete(cache.keys().next().value);
    }

    const timeMs = Date.now() - t0;
    log(`"${query}" done in ${timeMs}ms`);

    return { markdown, fromCache: false, timeMs };

  } catch (err) {
    log(`Error: ${err.message}`);
    return { error: err.message, timeMs: Date.now() - t0 };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

function parseHtml(html) {
  const $ = cheerio.load(html);
  const $c = $('[data-container-id="main-col"]').first();

  if (!$c.length) return null;

  // Cleanup
  $c.find('script, style, noscript, iframe').remove();
  $c.find('[data-ved]').remove();
  $c.find('[aria-label="Helpful"], [aria-label="Not helpful"], [aria-label*="Share"], [aria-label="More"]').remove();
  $c.find('h1, h2, h3').each((_, el) => {
    const txt = $(el).text().trim();
    if (txt === 'Generative AI is experimental.' || txt === 'About this result') {
      $(el).remove();
    }
  });

  const cleanHtml = $c.html();
  if (!cleanHtml) return null;

  let md = turndown.turndown(cleanHtml);

  // Minimal cleanup
  md = md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')  // Strip link syntax
    .replace(/\n{3,}/g, '\n\n')
    .replace(/Thinking\.\.\./g, '')
    .replace(/Generating\.\.\./g, '')
    .trim();

  return md;
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
      browser: browserContext ? 'connected' : 'initializing'
    };
  }

  return await search(q);
}

// ═══════════════════════════════════════════════════════════════
// SERVER
// ═══════════════════════════════════════════════════════════════

function startServer() {
  try { fs.unlinkSync(SOCKET_PATH); } catch {}

  server = net.createServer(socket => {
    let buffer = '';

    socket.on('data', async chunk => {
      buffer += chunk;
      const idx = buffer.indexOf('\n');
      if (idx === -1) return;

      const msg = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);

      try {
        const req = JSON.parse(msg);
        const res = await handleRequest(req);
        socket.write(JSON.stringify(res));
      } catch {
        socket.write(JSON.stringify({ error: 'Internal error' }));
      }
      socket.end();
    });

    socket.on('error', () => {});
  });

  server.listen(SOCKET_PATH, () => {
    log(`Listening on ${SOCKET_PATH}`);
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
  if (browserContext) await browserContext.close().catch(() => {});
  if (server) server.close();
  try { fs.unlinkSync(SOCKET_PATH); } catch {}
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', e => { console.error('Fatal:', e); shutdown(); });

startServer();