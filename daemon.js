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

// CAPTCHA Settings
const CAPTCHA_MAX_CONSECUTIVE = 3;   // Restart browser after 3 CAPTCHAs
const CAPTCHA_COOLDOWN_MS = 30_000;  // 30s cooldown after restart
const CAPTCHA_WAIT_TIMEOUT = 120_000; // 2 minutes to solve CAPTCHA

// Completion Detection Timeouts (optimized for speed)
const SVG_DETECTION_TIMEOUT = 10_000;   // 10s for SVG thumbs-up
const ARIA_DETECTION_TIMEOUT = 6_000;   // 6s for aria-label
const TEXT_DETECTION_TIMEOUT = 8_000;   // 8s for text polling
const OVERALL_TIMEOUT = 25_000;         // 25s overall timeout

// CAPTCHA Detection Indicators
const CAPTCHA_INDICATORS = [
  'unusual traffic',
  'are you a robot',
  'captcha',
  'verify you\'re human',
  'recaptcha'
];

const STEALTH = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = { runtime: {}, app: {} };
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
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
  if (cache.size > 100) {
    cache.delete(cache.keys().next().value);
  }
}

// ═══════════════════════════════════════════════════════════════
// BROWSER POOL
// ═══════════════════════════════════════════════════════════════

let context = null;
let page = null;
let pageReady = false;
let idleTimer = null;
let currentHeadless = true;
let consecutiveCaptchas = 0;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
}

async function initBrowser(headless = null) {
  const shouldBeHeadless = headless !== null ? headless : !DEBUG;

  // Recreate browser if headless mode changed
  if (context && currentHeadless !== shouldBeHeadless) {
    log(`Switching: ${currentHeadless ? 'headless' : 'visible'} → ${shouldBeHeadless ? 'headless' : 'visible'}`);
    await closeBrowser();
  }

  if (context && page && pageReady) return page;

  if (!fs.existsSync(PROFILE_PATH)) {
    throw new Error('Profile not found. Run: npm run setup');
  }

  if (context) {
    await context.close().catch(() => { });
  }

  currentHeadless = shouldBeHeadless;

  const options = {
    headless: shouldBeHeadless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-translate',
      '--no-first-run',
      '--disable-popup-blocking',
      '--disable-infobars',
      '--disable-notifications',
      '--lang=en-US',
      '--window-size=1280,800'
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US'
  };

  try {
    context = await chromium.launchPersistentContext(PROFILE_PATH, { ...options, channel: 'chrome' });
  } catch {
    context = await chromium.launchPersistentContext(PROFILE_PATH, options);
  }

  log(`Browser started (${shouldBeHeadless ? 'headless' : 'visible'})`);

  page = context.pages()[0] || await context.newPage();
  await page.addInitScript(STEALTH);

  // Resource blocking for speed
  await page.route('**/*', route => {
    const type = route.request().resourceType();
    const url = route.request().url();

    if (type === 'document') return route.continue();
    if (type === 'script' && (url.includes('google.com/xjs') || url.includes('google.com/js') || url.includes('gstatic.com'))) {
      return route.continue();
    }
    if ((type === 'xhr' || type === 'fetch') && url.includes('google.com')) {
      return route.continue();
    }
    return route.abort();
  });

  // Pre-warm: load Google homepage only
  await page.goto('https://www.google.com/?udm=50', {
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

async function restartBrowser(reason) {
  log(`Restarting browser: ${reason}`);
  await closeBrowser();
  log(`Cooldown: ${CAPTCHA_COOLDOWN_MS / 1000}s...`);
  await sleep(CAPTCHA_COOLDOWN_MS);
  consecutiveCaptchas = 0;
  await initBrowser(true);
}

// ═══════════════════════════════════════════════════════════════
// PARALLEL COMPLETION DETECTION (Promise.race)
// ═══════════════════════════════════════════════════════════════

// SVG selectors for feedback buttons (Helpful, Not helpful, Share - all use viewBox 3 3 18 18)
const SVG_SELECTORS = [
  'button svg[viewBox="3 3 18 18"]',              // Generic: any button with this viewBox
  'button span svg[viewBox="3 3 18 18"]',         // Share button pattern
  '[aria-label="Helpful"] svg',                   // Helpful button SVG
  '[aria-label="Not helpful"] svg',               // Not helpful button SVG
  '[aria-label=" Share"] svg',                    // Share button SVG (with leading space)
  '[aria-label="Share"] svg'                      // Share button SVG (without space)
].join(', ');

// Aria-label selectors (multi-language: helpful, not helpful, share)
const ARIA_SELECTORS = [
  // English (note: Share has leading space in actual HTML)
  '[aria-label="Helpful"]', '[aria-label="Not helpful"]', '[aria-label=" Share"]', '[aria-label="Share"]',
  // German
  '[aria-label="Hilfreich"]', '[aria-label="Nicht hilfreich"]', '[aria-label="Teilen"]',
  // French
  '[aria-label="Utile"]', '[aria-label="Pas utile"]', '[aria-label="Partager"]',
  // Spanish
  '[aria-label="Útil"]', '[aria-label="No es útil"]', '[aria-label="Compartir"]'
].join(', ');

async function waitForAiCompletion(pg) {
  const startTime = Date.now();
  log('Waiting for AI completion...');

  // Method 1: SVG icons (most reliable, language-independent)
  const svgPromise = pg.waitForSelector(SVG_SELECTORS, {
    timeout: OVERALL_TIMEOUT,
    state: 'visible'
  }).then(() => ({ method: 'svg', elapsed: Date.now() - startTime }));

  // Method 2: aria-label buttons (multi-language)
  const ariaPromise = pg.waitForSelector(ARIA_SELECTORS, {
    timeout: OVERALL_TIMEOUT,
    state: 'visible'
  }).then(() => ({ method: 'aria', elapsed: Date.now() - startTime }));

  // Method 3: Timeout fallback
  const timeoutPromise = sleep(OVERALL_TIMEOUT).then(() => ({ method: 'timeout', elapsed: OVERALL_TIMEOUT }));

  // Race - first to resolve wins
  try {
    const winner = await Promise.race([
      svgPromise.catch(() => new Promise(() => { })),
      ariaPromise.catch(() => new Promise(() => { })),
      timeoutPromise
    ]);
    log(`✓ ${winner.method} detected (${winner.elapsed}ms)`);
    return winner;
  } catch {
    return { method: 'timeout', elapsed: Date.now() - startTime };
  }
}

// ═══════════════════════════════════════════════════════════════
// CAPTCHA HANDLING
// ═══════════════════════════════════════════════════════════════

function detectCaptcha(html) {
  const lower = html.toLowerCase();
  return CAPTCHA_INDICATORS.some(ind => lower.includes(ind));
}

async function handleCaptcha(query) {
  consecutiveCaptchas++;
  log(`CAPTCHA detected! (${consecutiveCaptchas}/${CAPTCHA_MAX_CONSECUTIVE})`);

  if (consecutiveCaptchas >= CAPTCHA_MAX_CONSECUTIVE) {
    await restartBrowser('max CAPTCHAs');
    return { success: false, error: 'Too many CAPTCHAs - browser restarted. Please retry.', captchaRequired: true };
  }

  // Switch to visible mode
  await closeBrowser();
  const pg = await initBrowser(false);

  try {
    await pg.goto(`https://www.google.com/search?udm=50&q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });
  } catch (err) {
    return { success: false, error: `Navigation failed: ${err.message}`, captchaRequired: true };
  }

  log(`Waiting for CAPTCHA solution (${CAPTCHA_WAIT_TIMEOUT / 1000}s timeout)...`);
  const captchaDeadline = Date.now() + CAPTCHA_WAIT_TIMEOUT;

  while (Date.now() < captchaDeadline) {
    await sleep(2000);

    try {
      const html = await pg.content();
      if (!detectCaptcha(html)) {
        log('CAPTCHA solved!');
        await waitForAiCompletion(pg);

        const finalHtml = await pg.content();
        const markdown = parseToMarkdown(finalHtml);
        consecutiveCaptchas = 0;

        // Switch back to headless
        await closeBrowser();
        await initBrowser(true);

        return { success: true, markdown, fromCache: false };
      }
    } catch { }

    log('Waiting for CAPTCHA...');
  }

  return { success: false, error: 'CAPTCHA timeout', captchaRequired: true };
}

// ═══════════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════════

async function search(query) {
  const t0 = Date.now();

  const cached = getCached(query);
  if (cached) return { markdown: cached, fromCache: true };

  const pg = await initBrowser();
  log(`Browser ready: ${Date.now() - t0}ms`);

  const t1 = Date.now();
  await pg.goto(`https://www.google.com/search?udm=50&q=${encodeURIComponent(query)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 10000
  });
  log(`Navigation: ${Date.now() - t1}ms`);

  // Quick CAPTCHA check
  const html = await pg.content();
  if (detectCaptcha(html)) {
    return handleCaptcha(query);
  }

  // Wait for AI completion
  const t2 = Date.now();
  const completion = await waitForAiCompletion(pg);
  log(`Wait (${completion.method}): ${Date.now() - t2}ms`);

  // Get final content
  const finalHtml = await pg.content();
  if (DEBUG) fs.writeFileSync('debug.html', finalHtml);

  // Double-check CAPTCHA
  if (detectCaptcha(finalHtml)) {
    return handleCaptcha(query);
  }

  const markdown = parseToMarkdown(finalHtml);
  consecutiveCaptchas = 0;

  if (markdown) setCache(query, markdown);

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
    'script', 'style', 'noscript', 'svg', 'button', 'input', 'textarea',
    '[role="button"]', '[role="navigation"]',
    '.notranslate', '.txxDge', '.uJ19be', '.rBl3me',
    '[aria-label="Helpful"]', '[aria-label="Not helpful"]',
    '[aria-label="Hilfreich"]', '[aria-label="Nicht hilfreich"]',
    '.DBd2Wb', '.ya9Iof', '.v4bSkd', '[data-crb-el]', '.Fsg96', '.Jd31eb',
    '[aria-hidden="true"]', '[style*="display:none"]',
    '.NuOswe', '.LoBHAe', '.J945jc', '.AGtNEf', '.VKalRc', '.xXnAhe',
    '[data-ved]'
  ].join(', ')).remove();

  $clone.find('a').removeAttr('href');

  const cleanHtml = $clone.html();
  if (!cleanHtml) return null;

  return turndown.turndown(cleanHtml)
    .replace(/https?:\/\/[^\s)>\]]+/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/Thinking\s*/gi, '')
    .replace(/Generating\s*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || null;
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES & SERVER
// ═══════════════════════════════════════════════════════════════

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = msg => DEBUG && console.log(`[${Date.now() % 100000}] ${msg}`);

module.exports = { search, initBrowser, closeBrowser, shutdown, handleQuery };

async function handleQuery(queryText) {
  resetIdleTimer();

  if (queryText === '__STOP__') { shutdown(); return { stopped: true }; }
  if (queryText === '__STATUS__') {
    return { browserReady: pageReady, browserMode: currentHeadless ? 'headless' : 'visible', consecutiveCaptchas, cacheSize: cache.size, uptime: process.uptime() };
  }

  try {
    return await search(queryText);
  } catch (err) {
    pageReady = false;
    return { error: err.message };
  }
}

function startServer() {
  try { fs.unlinkSync(SOCKET_PATH); } catch { }

  const srv = net.createServer(socket => {
    let buffer = '';
    socket.on('data', async chunk => {
      buffer += chunk.toString();
      if (buffer.includes('\n')) {
        const line = buffer.split('\n')[0];
        buffer = '';
        try {
          const { query } = JSON.parse(line);
          log(`Query: ${query}`);
          socket.end(JSON.stringify(await handleQuery(query)));
        } catch (err) {
          socket.end(JSON.stringify({ error: err.message }));
        }
      }
    });
    socket.on('error', () => { });
  });

  srv.listen(SOCKET_PATH, () => {
    log(`Listening on ${SOCKET_PATH}`);
    resetIdleTimer();
    initBrowser().catch(err => log(`Pre-warm failed: ${err.message}`));
  });
  srv.on('error', err => { console.error('Server error:', err); process.exit(1); });
  return srv;
}

let server = null;

async function shutdown() {
  log('Shutting down...');
  if (idleTimer) clearTimeout(idleTimer);
  await closeBrowser();
  if (server) { server.close(); try { fs.unlinkSync(SOCKET_PATH); } catch { } }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) { server = startServer(); }