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
  'script', 'style', 'noscript', 'iframe',
  '[data-ved]',
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
// PARSER
// ═══════════════════════════════════════════════════════════════

function cleanDom($, $container) {
  $container.find(DOM_REMOVE_SELECTORS).remove();

  $container.find('h1, h2, h3').each((_, el) => {
    const txt = $(el).text().trim();
    if (HEADING_BLACKLIST.includes(txt)) {
      $(el).remove();
    }
  });
}

function cleanMarkdown(md) {
  // Safety net: turndown's stripLinks rule handles most <a> tags,
  // but nested or malformed HTML can produce leftover markdown links.
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

  const md = turndown.turndown(cleanHtml);
  return cleanMarkdown(md);
}

module.exports = { parseHtml };