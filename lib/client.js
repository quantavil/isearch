const net = require('net');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock');
const DAEMON_PATH = path.resolve(__dirname, '..', 'daemon.js');

function startDaemon() {
  return new Promise((resolve, reject) => {
    const daemon = spawn('node', [DAEMON_PATH], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env }
    });
    daemon.unref();

    const start = Date.now();
    const poll = () => {
      if (Date.now() - start > 10000) {
        return reject(new Error('Daemon startup timeout (10s)'));
      }
      const client = net.createConnection(SOCKET_PATH);
      client.on('connect', () => { 
        client.end(); 
        resolve(); 
      });
      client.on('error', () => setTimeout(poll, 150));
    };
    setTimeout(poll, 200);
  });
}

function query(payload, timeoutMs = 35000) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH);
    let data = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        client.destroy();
        reject(new Error('Request timeout'));
      }
    }, timeoutMs);

    client.on('connect', () => {
      client.write(JSON.stringify(payload) + '\n');
    });

    client.on('data', chunk => {
      data += chunk;
    });

    client.on('end', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON response from daemon'));
      }
    });

    client.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function search(queryText) {
  try {
    return await query({ query: queryText });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
      await startDaemon();
      return await query({ query: queryText });
    }
    throw err;
  }
}

async function status() {
  return await query({ query: '__STATUS__' });
}

async function stop() {
  return await query({ query: '__STOP__' }, 5000);
}

module.exports = { 
  search, 
  query,           // ← Now correctly named
  sendRequest: query,  // ← Alias for compatibility
  startDaemon, 
  status, 
  stop, 
  SOCKET_PATH,
  DAEMON_PATH 
};