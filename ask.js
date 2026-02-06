#!/usr/bin/env node

const net = require('net');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock');
const DAEMON_PATH = path.join(__dirname, 'daemon.js');

// ANSI Colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

// ═══════════════════════════════════════════════════════════════
// DAEMON MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function startDaemon() {
  return new Promise((resolve, reject) => {
    const daemon = spawn('node', [DAEMON_PATH], {
      detached: true,
      stdio: 'ignore', 
      env: { ...process.env } // Pass current env (useful for DEBUG=1)
    });
    
    daemon.unref();

    // Poll for socket creation
    const start = Date.now();
    const check = () => {
      if (Date.now() - start > 5000) return reject(new Error('Daemon failed to start (Timeout)'));
      
      const client = net.createConnection(SOCKET_PATH);
      client.on('connect', () => {
        client.end();
        resolve();
      });
      client.on('error', () => setTimeout(check, 100));
    };
    check();
  });
}

function sendRequest(payload) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH);
    let responseData = '';

    client.on('connect', () => {
      client.write(JSON.stringify(payload) + '\n');
    });

    client.on('data', chunk => responseData += chunk);

    client.on('end', () => {
      try {
        resolve(JSON.parse(responseData));
      } catch {
        reject(new Error('Invalid response from daemon'));
      }
    });

    client.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);

  // --- HELP ---
  if (!args.length || args.includes('-h') || args.includes('--help')) {
    console.log(`
${c.bold}Usage:${c.reset}
  ask "your query"    ${c.dim}# Search Google${c.reset}
  ask --status        ${c.dim}# Check daemon health${c.reset}
  ask --stop          ${c.dim}# Stop the background process${c.reset}
`);
    process.exit(0);
  }

  // --- STOP ---
  if (args.includes('--stop')) {
    try {
      await sendRequest({ query: '__STOP__' });
      console.log(`${c.green}Daemon stopped.${c.reset}`);
    } catch {
      console.log(`${c.dim}Daemon was not running.${c.reset}`);
    }
    process.exit(0);
  }

  // --- QUERY ---
  const query = args.includes('--status') ? '__STATUS__' : args.join(' ');

  try {
    // 1. Try sending directly
    let result;
    try {
      result = await sendRequest({ query });
    } catch (e) {
      // 2. If failed, start daemon and retry
      if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') {
        if (query !== '__STATUS__') {
            process.stdout.write(`${c.dim}Starting engine...${c.reset}\r`);
            await startDaemon();
            process.stdout.write('                  \r'); // clear line
            result = await sendRequest({ query });
        } else {
            console.log(`${c.yellow}Daemon is not running.${c.reset}`);
            process.exit(0);
        }
      } else {
        throw e;
      }
    }

    // 3. Render Result
    if (query === '__STATUS__') {
      console.log(`${c.bold}Daemon Status:${c.reset}`);
      console.log(`  Status:  ${c.green}${result.status}${c.reset}`);
      console.log(`  Uptime:  ${Math.floor(result.uptime)}s`);
      console.log(`  Cache:   ${result.cacheSize} items`);
      console.log(`  Browser: ${result.browser}`);
    } 
    else if (result.error) {
      console.error(`${c.red}Error:${c.reset} ${result.error}`);
      process.exit(1);
    } 
    else {
      // Print Markdown
      console.log(`\n${c.bold}${c.cyan}Q: ${query}${c.reset}`);
      if (result.fromCache) console.log(`${c.dim}(cached)${c.reset}`);
      console.log('\n' + result.markdown + '\n');
    }

  } catch (err) {
    console.error(`\n${c.red}Fatal Error:${c.reset} ${err.message}`);
    process.exit(1);
  }
}

main();