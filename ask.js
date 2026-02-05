#!/usr/bin/env node

const net = require('net');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock');
const DAEMON_PATH = path.join(__dirname, 'daemon.js');

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  white: '\x1b[97m',
  bgBlue: '\x1b[44m'
};

function sendQuery(query) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH);
    let data = '';

    client.on('connect', () => client.write(JSON.stringify({ query }) + '\n'));
    client.on('data', chunk => data += chunk.toString());
    client.on('end', () => {
      try { resolve(JSON.parse(data)); } 
      catch { reject(new Error('Invalid response')); }
    });
    client.on('error', reject);
  });
}

function startDaemon() {
  return new Promise((resolve, reject) => {
    const daemon = spawn('node', [DAEMON_PATH], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env }
    });
    daemon.unref();

    let attempts = 0;
    const check = () => {
      const client = net.createConnection(SOCKET_PATH);
      client.on('connect', () => { client.end(); resolve(); });
      client.on('error', () => {
        if (++attempts >= 50) reject(new Error('Daemon failed to start'));
        else setTimeout(check, 100);
      });
    };
    setTimeout(check, 200);
  });
}

async function query(q) {
  try {
    return await sendQuery(q);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
      process.stdout.write(`${c.dim}Starting daemon...${c.reset}\r`);
      await startDaemon();
      return await sendQuery(q);
    }
    throw err;
  }
}

function print(result, queryText, elapsed) {
  const cacheTag = result.fromCache ? `${c.green}[cached]${c.reset} ` : '';
  console.log(`\n${c.bgBlue}${c.white}${c.bold} 🔍 ${queryText} ${c.reset} ${cacheTag}${c.dim}(${elapsed}ms)${c.reset}\n`);

  if (result.markdown) {
    console.log(result.markdown);
    console.log('');
  } else if (result.error) {
    console.log(`${c.yellow}❌ ${result.error}${c.reset}\n`);
  } else {
    console.log(`${c.yellow}No AI Overview found.${c.reset}\n`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (!args.length || args[0] === '-h' || args[0] === '--help') {
    console.log(`
${c.cyan}${c.bold}Google Search CLI${c.reset}

${c.bold}Usage:${c.reset}  ask <query>
        ask --stop        Stop daemon
        ask --status      Show daemon status

${c.bold}Setup:${c.reset}  npm run setup
`);
    process.exit(0);
  }

  if (args[0] === '--stop') {
    try {
      await sendQuery('__STOP__');
      console.log(`${c.dim}Daemon stopped${c.reset}`);
    } catch {
      console.log(`${c.dim}Daemon not running${c.reset}`);
    }
    process.exit(0);
  }

  if (args[0] === '--status') {
    try {
      const status = await sendQuery('__STATUS__');
      console.log(`
${c.cyan}Daemon Status${c.reset}
  Browser ready: ${status.browserReady ? c.green + 'Yes' : c.yellow + 'No'}${c.reset}
  Cache size:    ${status.cacheSize} queries
  Uptime:        ${Math.round(status.uptime)}s
`);
    } catch {
      console.log(`${c.dim}Daemon not running${c.reset}`);
    }
    process.exit(0);
  }

  const queryText = args.join(' ');
  const start = Date.now();

  try {
    process.stdout.write(`${c.dim}Searching...${c.reset}`);
    const result = await query(queryText);
    process.stdout.write('\r\x1b[K');
    print(result, queryText, Date.now() - start);
  } catch (err) {
    process.stdout.write('\r\x1b[K');
    console.error(`\n${c.yellow}❌ ${err.message}${c.reset}\n`);
    process.exit(1);
  }
}

main();