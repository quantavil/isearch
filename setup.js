#!/usr/bin/env node

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const net = require('net');

const PROFILE_PATH = path.join(os.homedir(), '.google-search-cli', 'profile');
const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock');

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════

function killDaemon() {
  return new Promise(resolve => {
    const client = net.createConnection(SOCKET_PATH);
    client.on('connect', () => {
      console.log('⚠️  Daemon is running. Stopping it to free up Chrome profile...');
      client.write(JSON.stringify({ query: '__STOP__' }));
      client.end();
      setTimeout(resolve, 1000); // Give it a second to release the file lock
    });
    client.on('error', () => resolve()); // Not running, safe to proceed
  });
}

async function setup() {
  console.log('\n🔧 \x1b[1mGoogle Search CLI Setup\x1b[0m\n');

  // 1. Kill existing daemon to prevent SingletonLock error
  await killDaemon();

  // 2. Create directory
  fs.mkdirSync(PROFILE_PATH, { recursive: true });

  console.log('1. A browser window will open.');
  console.log('2. Log in to your Google Account.');
  console.log('3. Complete any CAPTCHAs if prompted.');
  console.log('4. \x1b[33mClose the browser window completely when done.\x1b[0m\n');
  console.log('Launching...\n');

  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE_PATH, {
      headless: false, // Must be visible
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled'
      ],
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    await page.goto('https://www.google.com/search?q=test');

    // Wait for the user to close the browser manually
    await new Promise(resolve => context.on('close', resolve));

    console.log('\n✅ \x1b[32mSetup complete! Profile saved.\x1b[0m');
    console.log('You can now run: \x1b[36mask "your query"\x1b[0m\n');

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    if (err.message.includes('SingletonLock')) {
      console.error('   Hint: Ensure all Chrome instances are closed.');
    }
  }
}

setup();