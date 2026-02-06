/**
 * Shared Constants Module
 * Centralizes configuration paths used across the codebase
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
const NAV_TIMEOUT = 10000;      // Reduced from 15s
const AI_WAIT_TIMEOUT = 5000;   // Reduced from 10s

// Cache
const CACHE_MAX = 50;

module.exports = {
    SOCKET_PATH,
    PROFILE_PATH,
    DAEMON_PATH,
    IDLE_TIMEOUT,
    NAV_TIMEOUT,
    AI_WAIT_TIMEOUT,
    CACHE_MAX
};
