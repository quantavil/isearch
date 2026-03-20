#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');
const { PROFILE_PATH } = require('./lib/constants');
const { stopAndWait } = require('./lib/client');

async function setup() {
  console.log('\n🔧 \x1b[1mGoogle Search CLI Setup\x1b[0m\n');

  // Stop any running daemon so the profile isn't locked
  try {
    console.log('⚠️  Stopping running daemon...');
    await stopAndWait();
    console.log('   Daemon stopped.\n');
  } catch {
    console.log('   No daemon running.\n');
  }

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
      console.error('   Close all Chrome instances first, or run: ask --stop');
    }
  }
}

setup();