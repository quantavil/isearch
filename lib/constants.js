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
const NAV_TIMEOUT = 15000;

// Cache
const CACHE_MAX = 50;

// Concurrency
const MAX_CONCURRENT = 3;

// Browser Path
const BROWSER_PATH = process.env.BROWSER_PATH || '/usr/bin/brave';

// Commands
const CMD_STOP = '__STOP__';
const CMD_STATUS = '__STATUS__';

// Resource blocking patterns (Playwright route-based, applied at context level)
const BLOCKED_RESOURCE_RE = /\.(png|jpe?g|gif|webp|ico|svg|css|woff2?|ttf|otf|mp[34]|webm)(\?|$)/i;
const TRACKER_RE = /(doubleclick|google-analytics|googlesyndication|googleadservices|facebook\.net|amazon-adsystem|adnxs|taboola|outbrain|criteo|hotjar|sentry|mixpanel|segment|amplitude)/i;

module.exports = {
    SOCKET_PATH,
    PROFILE_PATH,
    DAEMON_PATH,
    IDLE_TIMEOUT,
    NAV_TIMEOUT,
    CACHE_MAX,
    MAX_CONCURRENT,
    BROWSER_PATH,
    CMD_STOP,
    CMD_STATUS,
    BLOCKED_RESOURCE_RE,
    TRACKER_RE
};