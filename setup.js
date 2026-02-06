#!/usr/bin/env node

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');

const PROFILE_PATH = path.join(os.homedir(), '.google-search-cli', 'profile');
const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock');

function stopDaemon() {
  return new Promise(resolve => {
    const client = net.createConnection(SOCKET_PATH);
    client.on('connect', () => {
      console.log('⚠️  Stopping running daemon...');
      client.write(JSON.stringify({ query: '__STOP__' }) + '\n');
      client.end();
      setTimeout(resolve, 1000);
    });
    client.on('error', () => resolve());
  });
}

async function setup() {
  console.log('\n🔧 \x1b[1mGoogle Search CLI Setup\x1b[0m\n');

  await stopDaemon();

  fs.mkdirSync(PROFILE_PATH, { recursive: true });

  console.log('1. A browser window will open.');
  console.log('2. Log in to your Google Account.');
  console.log('3. Complete any CAPTCHAs if prompted.');
  console.log('4. \x1b[33mClose the browser window when done.\x1b[0m\n');

  try {
    const context = await chromium.launchPersistentContext(PROFILE_PATH, {
      headless: false,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    await page.goto('https://www.google.com/search?q=test');

    await new Promise(resolve => context.on('close', resolve));

    console.log('\n✅ \x1b[32mSetup complete!\x1b[0m');
    console.log('Run: \x1b[36mask "your query"\x1b[0m\n');
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.message.includes('SingletonLock')) {
      console.error('   Close all Chrome instances first.');
    }
  }
}

setup();