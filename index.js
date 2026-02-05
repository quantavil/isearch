#!/usr/bin/env node

const { chromium } = require('playwright');
const cheerio = require('cheerio');
const TurndownService = require('turndown');
const turndownPluginGfm = require('turndown-plugin-gfm');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const PROFILE_PATH = path.join(os.homedir(), '.google-search-cli', 'profile');
const DEBUG = process.env.DEBUG === '1';

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  white: '\x1b[97m',
  bgBlue: '\x1b[44m'
};

const STEALTH = `
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
  window.chrome = { runtime: {}, app: {} };
`;

const BLOCKED = [
  'google-analytics', 'googletagmanager', 'doubleclick', 'googlesyndication',
  'pagead', 'adservice', 'fonts.googleapis', 'fonts.gstatic', 'ogs.google'
];

// ═══════════════════════════════════════════════════════════════
// TURNDOWN SETUP (HTML → Markdown)
// ═══════════════════════════════════════════════════════════════

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  hr: '---'
});

// Add GFM support (tables, strikethrough, etc.)
turndown.use(turndownPluginGfm.gfm);

// Strip all links - keep only text
turndown.addRule('stripLinks', {
  filter: 'a',
  replacement: (content) => content
});

// Remove images completely
turndown.addRule('removeImages', {
  filter: 'img',
  replacement: () => ''
});

// Remove buttons
turndown.addRule('removeButtons', {
  filter: 'button',
  replacement: () => ''
});

// ═══════════════════════════════════════════════════════════════
// BROWSER + SEARCH
// ═══════════════════════════════════════════════════════════════

async function search(query) {
  if (!fs.existsSync(PROFILE_PATH)) {
    console.error(`\n${c.yellow}⚠ Run first: npm run setup${c.reset}\n`);
    process.exit(1);
  }

  const options = {
    headless: !DEBUG,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-extensions',
      '--window-size=1920,1080'
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  let context, html = '';

  try {
    try {
      context = await chromium.launchPersistentContext(PROFILE_PATH, { ...options, channel: 'chrome' });
    } catch {
      context = await chromium.launchPersistentContext(PROFILE_PATH, options);
    }

    const page = context.pages()[0] || await context.newPage();
    await page.addInitScript(STEALTH);

    await page.route('**/*', route => {
      const type = route.request().resourceType();
      const url = route.request().url();

      if (type === 'document' || type === 'script' || type === 'xhr' || type === 'fetch') {
        if (!BLOCKED.some(b => url.includes(b))) {
          return route.continue();
        }
      }
      return route.abort();
    });

    await page.goto(`https://www.google.com/search?udm=50&q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 15000
    });

    try {
      await page.waitForFunction(() => {
        const c = document.querySelector('.mZJni, [data-container-id="main-col"]');
        if (!c) return false;
        const hasContent = c.querySelectorAll('.Y3BBE, table, ul').length >= 1;
        const hasEnd = c.querySelector('.ya9Iof, .v4bSkd, .DBd2Wb, [aria-label="Helpful"]');
        return hasContent && hasEnd;
      }, { timeout: 8000 });
    } catch {}

    await page.waitForTimeout(300);
    html = await page.content();

    if (DEBUG) fs.writeFileSync('debug.html', html);

    if (html.includes('unusual traffic')) {
      throw new Error('CAPTCHA detected! Run: npm run setup');
    }

  } finally {
    if (context) context.close().catch(() => {});
  }

  return html;
}

// ═══════════════════════════════════════════════════════════════
// PARSE AI OVERVIEW → MARKDOWN
// ═══════════════════════════════════════════════════════════════

function parseToMarkdown(html) {
  const $ = cheerio.load(html);
  const $container = $('.mZJni, [data-container-id="main-col"]').first();
  
  if (!$container.length) return null;

  // Clone and clean
  const $clone = $container.clone();

  // Remove unwanted elements
  $clone.find([
    'script', 'style', 'noscript', 'svg', 'button',
    '.txxDge', '.notranslate', '.rBl3me', '.uJ19be',
    '.ya9Iof', '.v4bSkd', '.DBd2Wb',        // feedback buttons
    '.Sv6Kpe', '.hbL65e', '.gUMPPd',         // citation chips  
    '[aria-hidden="true"]',
    '[data-ved]',                            // tracking elements
    '[style*="display:none"]',
    '[style*="display: none"]'
  ].join(', ')).remove();

  // Remove all href attributes to ensure no links
  $clone.find('a').removeAttr('href');

  // Get cleaned HTML
  let cleanHtml = $clone.html();
  if (!cleanHtml) return null;

  // Convert to Markdown
  let markdown = turndown.turndown(cleanHtml);

  // Post-process cleanup
  markdown = markdown
    // Remove any remaining URLs
    .replace(/https?:\/\/[^\s)>\]]+/g, '')
    // Remove markdown link syntax leftovers
    .replace(/\[([^\]]+)\]\(\s*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Remove image syntax
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // Remove disclaimer text
    .replace(/.*AI can make mistakes.*\n?/gi, '')
    .replace(/.*double-check.*\n?/gi, '')
    .replace(/.*Learn more.*\n?/gi, '')
    // Clean up whitespace
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
    .trim();

  return markdown || null;
}

// ═══════════════════════════════════════════════════════════════
// OUTPUT
// ═══════════════════════════════════════════════════════════════

function print(markdown, query, elapsed) {
  console.log(`\n${c.bgBlue}${c.white}${c.bold} 🔍 ${query} ${c.reset} ${c.dim}(${elapsed}ms)${c.reset}\n`);

  if (markdown) {
    console.log(markdown);
    console.log('');
  } else {
    console.log(`${c.yellow}No AI Overview found.${c.reset}\n`);
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);

  if (!args.length || args[0] === '-h' || args[0] === '--help') {
    console.log(`
${c.cyan}${c.bold}Google Search CLI${c.reset}

${c.bold}Usage:${c.reset}  ask <query>
        DEBUG=1 ask <query>

${c.bold}Setup:${c.reset}  npm run setup
`);
    process.exit(0);
  }

  const query = args.join(' ');
  const start = Date.now();

  try {
    process.stdout.write(`${c.dim}Searching...${c.reset}`);

    const html = await search(query);
    const markdown = parseToMarkdown(html);

    process.stdout.write('\r\x1b[K');
    print(markdown, query, Date.now() - start);

  } catch (err) {
    process.stdout.write('\r\x1b[K');
    console.error(`\n${c.yellow}❌ ${err.message}${c.reset}\n`);
    if (DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

main();