/**
 * HTML Parser & Cleanup Module
 * Extracts clean markdown from Google AI search results
 */

const cheerio = require('cheerio');
const TurndownService = require('turndown');
const turndownPluginGfm = require('turndown-plugin-gfm');

// ═══════════════════════════════════════════════════════════════
// TURNDOWN CONFIGURATION
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
// CLEANUP PATTERNS
// ═══════════════════════════════════════════════════════════════

const DOM_REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'link',
  '[aria-label="Helpful"]',
  '[aria-label="Not helpful"]',
  '[aria-label*="Share"]',
  '[aria-label="More"]'
].join(', ');

const HEADING_BLACKLIST = [
  'Generative AI is experimental.',
  'About this result'
];

const FEEDBACK_PATTERNS = [
  /^Helpful\s*$/gm,
  /^Not helpful\s*$/gm,
  /^Thank you\s*$/gm,
  /^Your feedback helps Google.*$/gm,
  /^Share more feedback.*$/gm,
  /^Report a problem.*$/gm,
  /^See our Privacy Policy.*$/gm,
  /^Privacy Policy.*$/gm,
  /^Close\s*$/gm
];

// ═══════════════════════════════════════════════════════════════
// MATH EXTRACTION (Placeholder Approach)
// ═══════════════════════════════════════════════════════════════

// Why placeholders?
// -----------------
// Turndown's escape() runs on all text nodes:  \  →  \\
// If we inject "$\frac{4}{3}$" as a text node, turndown
// produces "$\\frac{4}{3}$".  By using a plain-ASCII placeholder
// (no backslashes, no markdown-special chars), turndown passes
// it through untouched.  We swap the real LaTeX back in AFTER
// turndown finishes.
//
// Safe for concurrent calls: parseHtml is synchronous, and
// Node's event loop won't interleave two synchronous calls.

let _mathStore = [];

function extractMath($, $container) {
  _mathStore = [];

  $container.find('img[data-xpm-latex]').each((_, img) => {
    const $img = $(img);
    const latex = $img.attr('data-xpm-latex');
    if (!latex) return;

    // Block vs inline detection
    const $copyRoot = $img.closest('[data-xpm-copy-root]');
    const style = $copyRoot.length ? ($copyRoot.attr('style') || '') : '';
    const isBlock = style.includes('inline-flex');

    const delimiter = isBlock ? '$$' : '$';
    const idx = _mathStore.length;
    // Placeholder: only uppercase letters + digits — nothing turndown escapes
    const placeholder = `XMATHX${idx}XENDX`;
    _mathStore.push(`${delimiter}${latex}${delimiter}`);

    // Replace outermost math container (removes SVG, MathML, <link>)
    const $outer = $img.closest('.mTEjhd');
    if ($outer.length) { $outer.replaceWith(placeholder); return; }

    const $outerBlock = $img.closest('.cPGBZb');
    if ($outerBlock.length) { $outerBlock.replaceWith(placeholder); return; }

    // Fallback chain
    const $inner = $img.closest('.dteT0b');
    if ($inner.length) { $inner.replaceWith(placeholder); return; }
    if ($copyRoot.length) { $copyRoot.replaceWith(placeholder); return; }
    $img.replaceWith(placeholder);
  });
}

function restoreMath(md) {
  return md.replace(/XMATHX(\d+)XENDX/g, (_, i) => _mathStore[parseInt(i)] || '');
}

// ═══════════════════════════════════════════════════════════════
// PARSER
// ═══════════════════════════════════════════════════════════════

function cleanDom($, $container) {
  // Extract math BEFORE removing other elements
  extractMath($, $container);

  $container.find(DOM_REMOVE_SELECTORS).remove();

  $container.find('h1, h2, h3').each((_, el) => {
    const txt = $(el).text().trim();
    if (HEADING_BLACKLIST.includes(txt)) {
      $(el).remove();
    }
  });
}

function cleanMarkdown(md) {
  md = md.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  for (const pattern of FEEDBACK_PATTERNS) {
    md = md.replace(pattern, '');
  }

  return md
    .replace(/\n{3,}/g, '\n\n')
    .replace(/Thinking\.\.\./g, '')
    .replace(/Generating\.\.\./g, '')
    .trim();
}

function parseHtml(html) {
  const $ = cheerio.load(html);
  const $container = $('[data-container-id="main-col"]').first();

  if (!$container.length) return null;

  cleanDom($, $container);

  const cleanHtml = $container.html();
  if (!cleanHtml) return null;

  let md = turndown.turndown(cleanHtml);

  // Restore LaTeX AFTER turndown (bypasses escape)
  md = restoreMath(md);

  return cleanMarkdown(md);
}

module.exports = { parseHtml };