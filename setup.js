#!/usr/bin/env node

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROFILE_PATH = path.join(os.homedir(), '.google-search-cli', 'profile');

async function setup() {
  fs.mkdirSync(PROFILE_PATH, { recursive: true });

  console.log('\n🔐 Google Search CLI Setup\n');
  console.log('1. Browser will open');
  console.log('2. Login to Google');
  console.log('3. Do a test search to build cookies');
  console.log('4. Close browser when done\n');

  let context;

  try {
    const options = {
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--disable-infobars',
        '--window-size=1280,800'
      ],
      ignoreDefaultArgs: ['--enable-automation'],
      viewport: { width: 1280, height: 800 }
    };

    // Try Chrome first
    try {
      context = await chromium.launchPersistentContext(PROFILE_PATH, {
        ...options,
        channel: 'chrome'
      });
      console.log('✓ Using Chrome\n');
    } catch {
      context = await chromium.launchPersistentContext(PROFILE_PATH, options);
      console.log('✓ Using Chromium\n');
    }

    const page = await context.newPage();

    // Go to Google search directly
    await page.goto('https://www.google.com/search?q=test&udm=50');

    console.log('⏳ Waiting for you to complete...\n');

    // Wait for close (max 5 min)
    await Promise.race([
      new Promise(resolve => context.on('close', resolve)),
      new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000))
    ]);

    try { await context.close(); } catch {}

    console.log('✅ Profile saved!\n');
    console.log('Now run: ask <query>\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

setup();