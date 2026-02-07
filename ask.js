#!/usr/bin/env node

const path = require('path');
const { query, startDaemon, stopAndWait } = require(path.join(__dirname, 'lib', 'client'));

// ═══════════════════════════════════════════════════════════════
// COLORS & BOX DRAWING
// ═══════════════════════════════════════════════════════════════

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

const B = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', lc: '├', rc: '┤' };

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const fmt = ms => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
const W = () => Math.min(process.stdout.columns || 80, 100) - 2;

function wrap(text, max) {
  const lines = [];
  for (const p of text.split('\n')) {
    if (!p.trim()) { lines.push(''); continue; }
    if (strip(p).length <= max) { lines.push(p); continue; }
    let cur = '';
    for (const w of p.split(' ')) {
      if (strip(cur + w).length > max) {
        if (cur) lines.push(cur.trimEnd());
        cur = w + ' ';
      } else {
        cur += w + ' ';
      }
    }
    if (cur.trim()) lines.push(cur.trimEnd());
  }
  return lines;
}

function padLine(text, width) {
  return text + ' '.repeat(Math.max(0, width - strip(text).length));
}

function renderBox(title, content, meta = {}) {
  const w = W();
  const inner = w - 2;
  const out = [];

  out.push(`${c.cyan}${B.tl}${B.h.repeat(w)}${B.tr}${c.reset}`);

  // Title
  const titleLine = `${c.bold}${c.cyan}Q:${c.reset} ${title}`;
  out.push(`${c.cyan}${B.v}${c.reset} ${padLine(titleLine, inner)} ${c.cyan}${B.v}${c.reset}`);

  // Meta line
  const parts = [];
  if (meta.fromCache) parts.push(`${c.yellow}⚡ cached${c.reset}`);
  if (meta.timeMs != null) parts.push(`${c.gray}${fmt(meta.timeMs)}${c.reset}`);
  if (meta.startup) parts.push(`${c.dim}(+${fmt(meta.startup)} startup)${c.reset}`);
  if (parts.length) {
    out.push(`${c.cyan}${B.v}${c.reset} ${padLine(parts.join('  '), inner)} ${c.cyan}${B.v}${c.reset}`);
  }

  // Separator
  out.push(`${c.cyan}${B.lc}${B.h.repeat(w)}${B.rc}${c.reset}`);

  // Content
  for (const line of wrap(content || 'No results found.', inner)) {
    out.push(`${c.cyan}${B.v}${c.reset} ${padLine(line, inner)} ${c.cyan}${B.v}${c.reset}`);
  }

  out.push(`${c.cyan}${B.bl}${B.h.repeat(w)}${B.br}${c.reset}`);

  return '\n' + out.join('\n') + '\n';
}

function renderStatus(r) {
  const mode = r.headless ? 'headless' : 'headed';
  return `
${c.bold}${c.cyan}◆ iSearch Daemon${c.reset}
${c.gray}─────────────────────${c.reset}
  Status:  ${c.green}●${c.reset} ${r.status}
  Mode:    ${mode}
  Uptime:  ${r.uptime}s
  Cache:   ${r.cacheSize} items
  Browser: ${r.browser}
`;
}

function renderHelp() {
  return `
${c.bold}${c.cyan}iSearch${c.reset} ${c.dim}v2.0${c.reset} - Lightning-fast Google Search

${c.bold}Usage:${c.reset}
  ${c.green}ask${c.reset} "your query"         Search Google (headless)
  ${c.green}ask${c.reset} --head "query"        Search with visible browser
  ${c.green}ask${c.reset} --head               Switch daemon to headed mode
  ${c.green}ask${c.reset} --headless            Switch daemon to headless mode
  ${c.green}ask${c.reset} --status             Check daemon status
  ${c.green}ask${c.reset} --stop               Stop the daemon

${c.bold}Examples:${c.reset}
  ${c.dim}$${c.reset} ask "what is rust"
  ${c.dim}$${c.reset} ask --head "debug this captcha"
  ${c.dim}$${c.reset} ask --headless
  ${c.dim}$${c.reset} ask "latest node.js version"
`;
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const rawArgs = process.argv.slice(2);

  // Extract mode flags before filtering
  const wantHeaded = rawArgs.includes('--head');
  const wantHeadless = rawArgs.includes('--headless');
  const args = rawArgs.filter(a => !['--head', '--headless'].includes(a));

  // Help — show when no args at all
  if (!rawArgs.length || args.includes('-h') || args.includes('--help')) {
    console.log(renderHelp());
    process.exit(0);
  }

  // Stop
  if (args.includes('--stop')) {
    try {
      await query({ query: '__STOP__' }, 3000);
      console.log(`${c.green}✔${c.reset} Daemon stopped.`);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') {
        console.log(`${c.dim}Daemon was not running.${c.reset}`);
      } else {
        console.error(`${c.red}Error:${c.reset} ${e.message}`);
      }
    }
    process.exit(0);
  }

  // Status
  if (args.includes('--status')) {
    try {
      const r = await query({ query: '__STATUS__' }, 3000);
      console.log(renderStatus(r));
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') {
        console.log(`\n${c.yellow}◆${c.reset} Daemon is ${c.yellow}not running${c.reset}`);
        console.log(`  ${c.dim}Start with: ask "your query"${c.reset}\n`);
      } else {
        console.error(`${c.red}Error:${c.reset} ${e.message}`);
      }
    }
    process.exit(0);
  }

  // ─── Search / Mode Switch ─────────────────────────────────

  // null = no preference (default to headless on fresh start)
  const desiredHeadless = wantHeaded ? false : (wantHeadless ? true : null);
  const q = args.join(' ');
  let startup = 0;

  try {
    // Probe daemon state
    let daemonRunning = false;
    let needRestart = false;

    try {
      const st = await query({ query: '__STATUS__' }, 2000);
      daemonRunning = true;
      // Restart only if an explicit mode flag was given and it differs
      if (desiredHeadless !== null && st.headless !== desiredHeadless) {
        needRestart = true;
      }
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ECONNREFUSED') throw e;
    }

    // Handle mode switch (stop → restart)
    if (needRestart) {
      const mode = desiredHeadless ? 'headless' : 'headed';
      process.stdout.write(`${c.dim}Restarting in ${mode} mode...${c.reset}`);
      await stopAndWait();
      const t0 = Date.now();
      await startDaemon({ headless: desiredHeadless });
      startup = Date.now() - t0;
      process.stdout.write(`\r${c.green}✔${c.reset} Engine ready (${mode}) ${c.dim}(${fmt(startup)})${c.reset}    \n`);

    } else if (!daemonRunning) {
      // Fresh start — use explicit flag or default to headless
      const headless = desiredHeadless !== null ? desiredHeadless : true;
      const mode = headless ? 'headless' : 'headed';
      process.stdout.write(`${c.dim}Starting engine...${c.reset}`);
      const t0 = Date.now();
      await startDaemon({ headless });
      startup = Date.now() - t0;
      process.stdout.write(`\r${c.green}✔${c.reset} Engine ready (${mode}) ${c.dim}(${fmt(startup)})${c.reset}    \n`);
    }

    // Mode-switch-only (no query)
    if (!q) {
      if (wantHeaded || wantHeadless) {
        const mode = wantHeaded ? 'headed' : 'headless';
        console.log(`${c.green}✔${c.reset} Daemon running in ${c.cyan}${mode}${c.reset} mode.`);
      }
      process.exit(0);
    }

    // Execute search
    const result = await query({ query: q });

    if (result.error) {
      console.error(`\n${c.red}✖ Error:${c.reset} ${result.error}`);
      if (result.error.includes('CAPTCHA')) {
        console.error(`  ${c.dim}Run: npm run setup${c.reset}`);
      }
      console.log();
      process.exit(1);
    }

    console.log(renderBox(q, result.markdown, {
      fromCache: result.fromCache,
      timeMs: result.timeMs,
      startup: startup || undefined
    }));

  } catch (e) {
    console.error(`\n${c.red}✖ Fatal:${c.reset} ${e.message}\n`);
    process.exit(1);
  }
}

main();
