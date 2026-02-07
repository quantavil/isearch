/**
 * Shared Constants Module
 */

const path = require('path');
const os = require('os');

// Socket and profile paths
const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock');
const PROFILE_PATH = path.join(os.homedir(), '.google-search-cli', 'profile');

// Daemon configuration
const DAEMON_PATH = path.resolve(__dirname, '..', 'daemon.js');

// Timeouts (in milliseconds)
const IDLE_TIMEOUT = 300_000;
const NAV_TIMEOUT = 5000;
const AI_WAIT_TIMEOUT = 3000;

// Cache
const CACHE_MAX = 50;

// Concurrency
const MAX_CONCURRENT = 3;

// CDP blocked URLs (centralized)
const BLOCKED_URLS = [
    '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.svg',
    '*.css',
    '*.woff', '*.woff2', '*.ttf', '*.otf',
    '*.mp4', '*.webm', '*.mp3',
    'manifest.json', 'opensearch.xml',
    '*doubleclick*', '*google-analytics*', '*googlesyndication*',
    '*googleadservices*', '*facebook*', '*twitter*', '*linkedin*',
    '*consent*', '*cookie*', '*quantserve*', '*scorecardresearch*', '*zedo*',
    '*adservice*', '*client_204*', '*gen_204*',
    // Additional Ad Networks & Trackers
    '*amazon-adsystem*', '*adnxs*', '*media.net*', '*taboola*', '*outbrain*',
    '*rubiconproject*', '*criteo*', '*advertising.com*', '*pubmatic*',
    '*moatads*', '*intercom*', '*drift*', '*hotjar*',
    '*sentry*', '*bugsnag*', '*newrelic*', '*datadog*',
    '*loggly*', '*mixpanel*', '*segment*', '*amplitude*', '*heap*'
];

module.exports = {
    SOCKET_PATH,
    PROFILE_PATH,
    DAEMON_PATH,
    IDLE_TIMEOUT,
    NAV_TIMEOUT,
    AI_WAIT_TIMEOUT,
    CACHE_MAX,
    MAX_CONCURRENT,
    BLOCKED_URLS
};