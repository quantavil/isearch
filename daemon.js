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
// CONFIG
// ═══════════════════════════════════════════════════════════════

const IDLE_TIMEOUT = 180_000;        // Close browser after 180s idle
const CACHE_TTL = 300_000;           // Cache results for 5 minutes
const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock');
const PROFILE_PATH = path.join(os.homedir(), '.google-search-cli', 'profile');
const DEBUG = process.env.DEBUG === '1';

const STEALTH = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = { runtime: {}, app: {} };
`;

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
turndown.addRule('removeImages', { filter: 'img', replacement: () => '' });
turndown.addRule('removeButtons', { filter: 'button', replacement: () => '' });

// ═══════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════

const cache = new Map();

function getCached(query) {
  const key = query.toLowerCase().trim();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    log(`Cache hit: ${key}`);
    return cached.markdown;
  }
  return null;
}

function setCache(query, markdown) {
  const key = query.toLowerCase().trim();
  cache.set(key, { markdown, time: Date.now() });

  // Limit cache size
  if (cache.size > 100) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}

// ═══════════════════════════════════════════════════════════════
// BROWSER POOL - Single persistent page
// ═══════════════════════════════════════════════════════════════

let context = null;
let page = null;
let pageReady = false;
let idleTimer = null;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
}

async function initBrowser() {
  if (context && page && pageReady) return page;

  if (!fs.existsSync(PROFILE_PATH)) {
    throw new Error('Profile not found. Run: npm run setup');
  }

  // Close existing if any
  if (context) {
    await context.close().catch(() => { });
  }

  const options = {
    headless: !DEBUG,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--no-first-run',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-component-update',
      '--window-size=1280,800'
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  try {
    context = await chromium.launchPersistentContext(PROFILE_PATH, { ...options, channel: 'chrome' });
  } catch {
    context = await chromium.launchPersistentContext(PROFILE_PATH, options);
  }

  log('Browser started');

  // Get or create single page
  page = context.pages()[0] || await context.newPage();

  // Setup once
  await page.addInitScript(STEALTH);

  // Aggressive resource blocking
  await page.route('**/*', route => {
    const type = route.request().resourceType();
    const url = route.request().url();

    // Allow only essential
    if (type === 'document') return route.continue();

    // Allow Google's core scripts only
    if (type === 'script') {
      if (url.includes('google.com/xjs') ||
        url.includes('google.com/js') ||
        url.includes('gstatic.com/og')) {
        return route.continue();
      }
      return route.abort();
    }

    // Allow XHR/Fetch for AI responses
    if (type === 'xhr' || type === 'fetch') {
      if (url.includes('google.com')) {
        return route.continue();
      }
    }

    // Block everything else: images, css, fonts, media, etc.
    return route.abort();
  });

  // Pre-warm: navigate to Google
  await page.goto('https://www.google.com/search?udm=50&q=test', {
    waitUntil: 'domcontentloaded',
    timeout: 10000
  }).catch(() => { });

  pageReady = true;
  log('Page ready');

  return page;
}

async function closeBrowser() {
  pageReady = false;
  page = null;
  if (context) {
    await context.close().catch(() => { });
    context = null;
    log('Browser closed');
  }
}

// ═══════════════════════════════════════════════════════════════
// SEARCH - Ultra fast
// ═══════════════════════════════════════════════════════════════

async function search(query) {
  const t0 = Date.now();

  // Check cache first
  const cached = getCached(query);
  if (cached !== null) {
    return { markdown: cached, fromCache: true };
  }

  const pg = await initBrowser();

  const t1 = Date.now();
  log(`Browser ready: ${t1 - t0}ms`);

  // Navigate (reusing same page)
  await pg.goto(`https://www.google.com/search?udm=50&q=${encodeURIComponent(query)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 10000
  });

  const t2 = Date.now();
  log(`Navigation: ${t2 - t1}ms`);

  // Fast wait - progressive checking
  try {
    await pg.waitForFunction(() => {
      const main = document.querySelector('[data-container-id="main-col"]');
      if (!main) return false;

      const text = main.innerText || '';

      // Quick answers (like 1+1) have short text but complete fast
      // Complex answers have longer text
      // Either way, check if "Thinking" is gone
      const thinking = document.querySelector('.NuOswe, .LoBHAe, .J945jc');
      const feedback = document.querySelector('[aria-label="Helpful"]');

      // Done if: has content AND (no thinking OR has feedback)
      return text.length > 10 && (!thinking || feedback);
    }, { timeout: 6000, polling: 50 });  // Faster polling
  } catch {
    log('Wait timeout - using partial content');
  }

  const t3 = Date.now();
  log(`Content wait: ${t3 - t2}ms`);

  const html = await pg.content();

  if (DEBUG) fs.writeFileSync('debug.html', html);

  if (html.includes('unusual traffic')) {
    throw new Error('CAPTCHA detected! Run: npm run setup');
  }

  const markdown = parseToMarkdown(html);

  // Cache result
  if (markdown) {
    setCache(query, markdown);
  }

  log(`Total: ${Date.now() - t0}ms`);

  return { markdown, fromCache: false };
}

// ═══════════════════════════════════════════════════════════════
// PARSE
// ═══════════════════════════════════════════════════════════════

function parseToMarkdown(html) {
  const $ = cheerio.load(html);
  const $container = $('[data-container-id="main-col"]').first();

  if (!$container.length) return null;

  const $clone = $container.clone();

  $clone.find([
    'script', 'style', 'noscript', 'svg', 'button',
    '[role="button"]',
    '.notranslate', '.txxDge', '.uJ19be', '.rBl3me',
    '[aria-label="Helpful"]', '[aria-label="Not helpful"]',
    '.DBd2Wb', '.ya9Iof', '.v4bSkd',
    '[data-crb-el]', '.Fsg96', '.Jd31eb',
    '[aria-hidden="true"]',
    '[style*="display:none"]',
    '.NuOswe', '.LoBHAe', '.J945jc',
    '.AGtNEf', '.VKalRc', '.xXnAhe'
  ].join(', ')).remove();

  $clone.find('a').removeAttr('href');

  let cleanHtml = $clone.html();
  if (!cleanHtml) return null;

  let markdown = turndown.turndown(cleanHtml);

  markdown = markdown
    .replace(/https?:\/\/[^\s)>\]]+/g, '')
    .replace(/\[([^\]]+)\]\(\s*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/Thinking\s*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return markdown || null;
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
  search,
  initBrowser,
  closeBrowser,
  shutdown,
  handleQuery
};

// ═══════════════════════════════════════════════════════════════
// SERVER
// ═══════════════════════════════════════════════════════════════

function log(msg) {
  if (DEBUG) console.log(`[${Date.now() % 100000}] ${msg}`);
}

async function handleQuery(queryText) {
  resetIdleTimer();

  if (queryText === '__STOP__') {
    shutdown();
    return { stopped: true };
  }

  if (queryText === '__STATUS__') {
    return {
      browserReady: pageReady,
      cacheSize: cache.size,
      uptime: process.uptime()
    };
  }

  try {
    const { markdown, fromCache } = await search(queryText);
    return { markdown, fromCache };
  } catch (err) {
    // On error, reset browser for next query
    pageReady = false;
    return { error: err.message };
  }
}

function startServer() {
  try { fs.unlinkSync(SOCKET_PATH); } catch { }

  const server = net.createServer(socket => {
    let buffer = '';

    socket.on('data', async chunk => {
      buffer += chunk.toString();

      if (buffer.includes('\n')) {
        const line = buffer.split('\n')[0];
        buffer = '';

        try {
          const { query } = JSON.parse(line);
          log(`Query: ${query}`);
          const result = await handleQuery(query);
          socket.end(JSON.stringify(result));
        } catch (err) {
          socket.end(JSON.stringify({ error: err.message }));
        }
      }
    });

    socket.on('error', () => { });
  });

  server.listen(SOCKET_PATH, () => {
    log(`Listening on ${SOCKET_PATH}`);
    resetIdleTimer();

    // Pre-warm browser on startup
    initBrowser().catch(err => log(`Pre-warm failed: ${err.message}`));
  });

  server.on('error', err => {
    console.error('Server error:', err);
    process.exit(1);
  });

  return server;
}

let server = null;

async function shutdown() {
  log('Shutting down...');
  if (idleTimer) clearTimeout(idleTimer);
  await closeBrowser();
  if (server) {
    server.close();
    try { fs.unlinkSync(SOCKET_PATH); } catch { }
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) {
  server = startServer();
}