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

const IDLE_TIMEOUT = 300_000;         // Auto-shutdown after 5 minutes
const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock');
const PROFILE_PATH = path.join(os.homedir(), '.google-search-cli', 'profile');
const DEBUG = process.env.DEBUG === '1';

// Timeouts
const NAV_TIMEOUT = 15000;            // 15s to load Google
const AI_WAIT_TIMEOUT = 10000;        // 10s max wait for AI generation
const OVERALL_TIMEOUT = 30000;        // 30s hard limit per query

// ═══════════════════════════════════════════════════════════════
// TURNDOWN (HTML -> Markdown)
// ═══════════════════════════════════════════════════════════════

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  hr: '---'
});

turndown.use(turndownPluginGfm.gfm);
turndown.addRule('stripLinks', { filter: 'a', replacement: content => content });
turndown.addRule('removeMedia', { filter: ['img', 'svg', 'canvas', 'video', 'audio'], replacement: () => '' });
turndown.addRule('removeInteractive', { filter: ['button', 'input', 'form', 'nav', 'footer', 'header'], replacement: () => '' });

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════

let browserContext = null;
let idleTimer = null;
let server = null;
const cache = new Map();

function log(msg) {
  if (DEBUG) console.log(`[${new Date().toISOString().split('T')[1]}] ${msg}`);
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(shutdown, IDLE_TIMEOUT);
}

// ═══════════════════════════════════════════════════════════════
// BROWSER MANAGEMENT
// ═══════════════════════════════════════════════════════════════

async function initContext() {
  if (browserContext) return browserContext;

  if (!fs.existsSync(PROFILE_PATH)) {
    throw new Error('Profile not found. Run: npm run setup');
  }

  log('Launching persistent context...');

  const args = [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-component-extensions-with-background-pages',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--no-first-run',
    '--disable-notifications',
    '--disable-background-networking',
    '--lang=en-US'
  ];

  try {
    browserContext = await chromium.launchPersistentContext(PROFILE_PATH, {
      headless: !DEBUG, 
      args,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    });
  } catch (e) {
    console.error(`Browser launch failed: ${e.message}`);
    // Retry once if locked
    if (e.message.includes('SingletonLock')) {
      throw new Error('Profile is locked. Close Chrome or kill other daemon instances.');
    }
    throw e;
  }

  return browserContext;
}

async function getNewPage() {
  const ctx = await initContext();
  const page = await ctx.newPage();

  // 1. Stealth Scripts
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    window.chrome = { runtime: {} };
  });

  // 2. CDP High-Performance Blocking
  // This blocks requests at the C++ layer (much faster than page.route)
  try {
    const client = await ctx.newCDPSession(page);
    await client.send('Network.setBlockedURLs', {
      urls: [
        '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.svg',
        '*.woff', '*.woff2', '*.ttf', 
        '*.mp4', '*.webm', '*.mp3',
        '*doubleclick*', '*google-analytics*', '*googlesyndication*',
        '*facebook*', '*twitter*', '*linkedin*'
      ]
    });
    await client.send('Network.enable');
  } catch (e) {
    log(`CDP Setup warning: ${e.message}`);
  }

  return page;
}

// ═══════════════════════════════════════════════════════════════
// SEARCH LOGIC
// ═══════════════════════════════════════════════════════════════

async function search(query) {
  const cacheKey = query.toLowerCase().trim();
  
  // 1. Check Cache
  if (cache.has(cacheKey)) {
    log(`Cache hit: "${query}"`);
    return { markdown: cache.get(cacheKey), fromCache: true };
  }

  let page = null;

  try {
    const tStart = Date.now();
    page = await getNewPage();

    // 2. Navigate (Fast)
    // We use 'domcontentloaded' because we don't need all external assets
    await page.goto(`https://www.google.com/search?udm=50&q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: NAV_TIMEOUT
    });

    // 3. CAPTCHA Check
    const isCaptcha = await page.$('form[action*="Captcha"], #captcha-form');
    if (isCaptcha) {
      throw new Error("CAPTCHA detected. Please run 'npm run setup' manually to clear it.");
    }

    // 4. Wait for AI Result (Heuristic)
    // We look for the main container. If AI is generating, we wait for specific indicators.
    try {
      // Main container
      await page.waitForSelector('[data-container-id="main-col"]', { timeout: 5000 });
      
      // Wait for AI completion indicator (The "Share" or "Feedback" icons appear when done)
      // This SVG viewbox is common for the feedback buttons
      await page.waitForSelector('svg[viewBox="3 3 18 18"]', { timeout: AI_WAIT_TIMEOUT });
    } catch (e) {
      log('AI Wait Timeout or Not Found (Standard results might be used)');
    }

    // 5. Extract & Parse
    const html = await page.content();
    const markdown = parseHtml(html);

    if (!markdown) {
        throw new Error("Failed to parse content (Structure might have changed).");
    }

    // 6. Update Cache
    cache.set(cacheKey, markdown);
    if (cache.size > 50) cache.delete(cache.keys().next().value); // LRU-ish

    log(`Query "${query}" finished in ${Date.now() - tStart}ms`);
    return { markdown, fromCache: false };

  } catch (err) {
    log(`Error: ${err.message}`);
    return { error: err.message };
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

function parseHtml(html) {
  const $ = cheerio.load(html);
  const $container = $('[data-container-id="main-col"]').first();
  
  if (!$container.length) return null;

  // Cleanup DOM to reduce Turndown work
  $container.find('script, style, noscript, iframe').remove();
  $container.find('div[data-ved], span[data-ved]').remove(); // Remove tracking data attributes
  $container.find('[aria-label="Helpful"], [aria-label="More"], [aria-label*="Share"]').remove();
  $container.find('h1, h2, h3').each((i, el) => {
      // Sometimes Google puts random text in headings
      if ($(el).text().trim() === 'Generative AI is experimental.') $(el).remove();
  });

  const cleanHtml = $container.html();
  if (!cleanHtml) return null;

  let md = turndown.turndown(cleanHtml);

  // Post-processing Markdown
  md = md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // Remove links, keep text
    .replace(/\n{3,}/g, '\n\n')               // Collapse excessive newlines
    .replace(/Thinking\.\.\./g, '')           // Remove loading text
    .replace(/Generating\.\.\./g, '')
    .trim();

  return md;
}

// ═══════════════════════════════════════════════════════════════
// SERVER
// ═══════════════════════════════════════════════════════════════

async function handleRequest(data) {
  resetIdleTimer();

  if (data.query === '__STOP__') {
    shutdown();
    return { stopped: true };
  }
  
  if (data.query === '__STATUS__') {
    return { 
      status: 'running', 
      uptime: process.uptime(), 
      cacheSize: cache.size,
      browser: !!browserContext ? 'connected' : 'waiting'
    };
  }

  return await search(data.query);
}

function startServer() {
  // 1. Clean up old socket
  try {
    if (fs.existsSync(SOCKET_PATH)) fs.unlinkSync(SOCKET_PATH);
  } catch (e) {
    console.error(`Socket cleanup warning: ${e.message}`);
  }

  // 2. Start Server
  server = net.createServer(socket => {
    let buffer = '';
    
    socket.on('data', async chunk => {
      buffer += chunk;
      
      // Handle potential fragmented packets (simple newline delimiter)
      if (buffer.includes('\n')) {
        const parts = buffer.split('\n');
        const message = parts[0];
        
        try {
          const json = JSON.parse(message);
          const response = await handleRequest(json);
          socket.write(JSON.stringify(response));
        } catch (e) {
          socket.write(JSON.stringify({ error: "Invalid JSON or Internal Error" }));
        } finally {
          socket.end();
        }
        buffer = parts.slice(1).join('\n');
      }
    });
  });

  server.listen(SOCKET_PATH, () => {
    log(`Daemon listening on ${SOCKET_PATH}`);
    resetIdleTimer();
    
    // Pre-warm the browser immediately
    initContext().catch(e => {
        if(DEBUG) console.error("Warmup failed:", e.message);
    });
  });

  server.on('error', (e) => {
    console.error(`Server error: ${e.message}`);
    process.exit(1);
  });
}

async function shutdown() {
  log('Shutting down...');
  if (browserContext) {
    await browserContext.close().catch(() => {});
    browserContext = null;
  }
  if (server) server.close();
  try { fs.unlinkSync(SOCKET_PATH); } catch (e) {}
  process.exit(0);
}

// Handle signals
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  shutdown();
});

// Start
startServer();