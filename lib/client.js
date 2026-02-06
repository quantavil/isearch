const net = require('net');
const { spawn } = require('child_process');
const { SOCKET_PATH, DAEMON_PATH } = require('./constants');

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

    const timer = setTimeout(() => {
      if (!done) { done = true; client.destroy(); reject(new Error('Request timeout')); }
    }, timeoutMs);

    client.on('connect', () => client.write(JSON.stringify(payload) + '\n'));
    client.on('data', chunk => data += chunk);
    client.on('end', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid daemon response')); }
    });
    client.on('error', err => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function search(q) {
  try {
    return await query({ query: q });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
      await startDaemon();
      return await query({ query: q });
    }
    throw err;
  }
}

async function status() {
  return await query({ query: '__STATUS__' }, 5000);
}

async function stop() {
  return await query({ query: '__STOP__' }, 3000);
}

module.exports = { search, query, startDaemon, status, stop, SOCKET_PATH, DAEMON_PATH };