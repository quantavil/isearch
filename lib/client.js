const net = require('net');
const { spawn } = require('child_process');
const { SOCKET_PATH, DAEMON_PATH, CMD_STOP, CMD_STATUS } = require('./constants');

const isDaemonDown = (e) => e && (e.code === 'ENOENT' || e.code === 'ECONNREFUSED');

/**
 * Start the daemon process.
 * @param {object} opts
 * @param {boolean} [opts.headless] - true for headless, false for headed
 */
function startDaemon(opts = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env };
    if (opts.headless !== undefined) env.HEADLESS = String(opts.headless);

    const daemon = spawn('bun', [DAEMON_PATH], {
      detached: true,
      stdio: 'ignore',
      env
    });
    daemon.unref();

    const start = Date.now();
    const poll = () => {
      if (Date.now() - start > 10000) {
        return reject(new Error('Daemon startup timeout'));
      }
      const client = net.createConnection(SOCKET_PATH);
      client.on('connect', () => { client.end(); resolve(); });
      client.on('error', () => setTimeout(poll, 100));
    };
    setTimeout(poll, 200);
  });
}

function query(payload, timeoutMs = 35000) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH);
    let data = '';
    let done = false;

    const finish = () => { if (done) return false; done = true; clearTimeout(timer); return true; };

    const timer = setTimeout(() => {
      if (finish()) { client.destroy(); reject(new Error('Request timeout')); }
    }, timeoutMs);

    client.on('connect', () => client.write(JSON.stringify(payload) + '\n'));
    client.on('data', chunk => data += chunk);
    client.on('end', () => {
      if (!finish()) return;
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid daemon response')); }
    });
    client.on('error', err => {
      if (!finish()) return;
      reject(err);
    });
  });
}

/**
 * Search with auto-start. Used by MCP and programmatic callers.
 */
async function search(q) {
  try {
    return await query({ query: q });
  } catch (err) {
    if (isDaemonDown(err)) {
      await startDaemon();
      return await query({ query: q });
    }
    throw err;
  }
}

async function status() {
  return await query({ query: CMD_STATUS }, 5000);
}

async function stop() {
  return await query({ query: CMD_STOP }, 3000);
}

/**
 * Stop daemon and poll until it's fully down (profile lock released).
 */
async function stopAndWait(maxWait = 5000) {
  try {
    await query({ query: CMD_STOP }, 3000);
  } catch {
    return; // Already not running
  }

  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      await query({ query: CMD_STATUS }, 500);
      await new Promise(r => setTimeout(r, 200));
    } catch {
      return; // Socket gone — daemon stopped
    }
  }
  throw new Error('Daemon failed to stop in time');
}

module.exports = { search, query, startDaemon, status, stop, stopAndWait, isDaemonDown };