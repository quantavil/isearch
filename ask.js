#!/usr/bin/env node

const { search, query, startDaemon, SOCKET_PATH } = require('./lib/client');

// ═══════════════════════════════════════════════════════════════
// BEAUTIFUL TERMINAL OUTPUT
// ═══════════════════════════════════════════════════════════════

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGray: '\x1b[100m'
};

const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };

function boxTop(width) {
  return `${c.dim}${BOX.tl}${BOX.h.repeat(width)}${BOX.tr}${c.reset}`;
}
function boxBottom(width) {
  return `${c.dim}${BOX.bl}${BOX.h.repeat(width)}${BOX.br}${c.reset}`;
}
function boxLine(content, width) {
  const stripped = content.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, width - stripped.length);
  return `${c.dim}${BOX.v}${c.reset} ${content}${' '.repeat(pad)}${c.dim}${BOX.v}${c.reset}`;
}

function formatTime(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function printResult(queryText, result) {
  const width = Math.min(process.stdout.columns || 80, 100) - 4;
  
  console.log();
  console.log(boxTop(width));
  console.log(boxLine(`${c.cyan}${c.bold}Q:${c.reset} ${queryText}`, width));
  
  // Meta line
  const meta = [];
  if (result.fromCache) meta.push(`${c.yellow}⚡ cached${c.reset}`);
  if (result.timeMs !== undefined) meta.push(`${c.dim}${formatTime(result.timeMs)}${c.reset}`);
  if (meta.length) console.log(boxLine(meta.join('  '), width));
  
  console.log(`${c.dim}${BOX.v}${BOX.h.repeat(width)}${BOX.v}${c.reset}`);
  
  // Content
  const lines = (result.markdown || 'No results found.').split('\n');
  for (const line of lines) {
    // Word wrap long lines
    const words = line.split(' ');
    let current = '';
    for (const word of words) {
      if ((current + word).length > width - 2) {
        if (current) console.log(boxLine(current.trim(), width));
        current = word + ' ';
      } else {
        current += word + ' ';
      }
    }
    if (current.trim()) console.log(boxLine(current.trim(), width));
    if (!line.trim()) console.log(boxLine('', width));
  }
  
  console.log(boxBottom(width));
  console.log();
}

function printStatus(result) {
  console.log(`
${c.bold}${c.cyan}◆ Daemon Status${c.reset}
${c.dim}├─${c.reset} Status:  ${c.green}${result.status}${c.reset}
${c.dim}├─${c.reset} Uptime:  ${Math.floor(result.uptime)}s
${c.dim}├─${c.reset} Cache:   ${result.cacheSize} items
${c.dim}├─${c.reset} Pool:    ${result.poolSize || 0} pages
${c.dim}╰─${c.reset} Browser: ${result.browser === 'connected' ? c.green : c.yellow}${result.browser}${c.reset}
`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);

  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log(`
${c.bold}${c.cyan}iSearch${c.reset} - Fast Google Search CLI

${c.bold}Usage:${c.reset}
  ${c.green}ask${c.reset} "your query"    Search Google
  ${c.green}ask${c.reset} --status        Check daemon health
  ${c.green}ask${c.reset} --stop          Stop background process

${c.dim}Examples:${c.reset}
  ask "best rust web frameworks 2025"
  ask "how to center a div"
`);
    process.exit(0);
  }

  if (args.includes('--stop')) {
    try {
      await query({ query: '__STOP__' });
      console.log(`${c.green}✓${c.reset} Daemon stopped.`);
    } catch {
      console.log(`${c.dim}Daemon was not running.${c.reset}`);
    }
    process.exit(0);
  }

  const queryText = args.includes('--status') ? '__STATUS__' : args.join(' ');
  const overallStart = Date.now();

  try {
    let result;
    let startupTime = 0;
    
    try {
      result = await query({ query: queryText });
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') {
        if (queryText === '__STATUS__') {
          console.log(`${c.yellow}Daemon is not running.${c.reset}`);
          process.exit(0);
        }
        process.stdout.write(`${c.dim}Starting engine...${c.reset}`);
        const t0 = Date.now();
        await startDaemon();
        startupTime = Date.now() - t0;
        process.stdout.write(`\r${c.green}✓${c.reset} Engine started in ${formatTime(startupTime)}  \n`);
        result = await query({ query: queryText });
      } else {
        throw e;
      }
    }

    if (queryText === '__STATUS__') {
      printStatus(result);
    } else if (result.error) {
      console.error(`\n${c.red}✗ Error:${c.reset} ${result.error}\n`);
      process.exit(1);
    } else {
      printResult(queryText, result);
    }

  } catch (err) {
    console.error(`\n${c.red}✗ Fatal:${c.reset} ${err.message}\n`);
    process.exit(1);
  }
}

main();