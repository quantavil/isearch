/**
 * Shared Constants Module
 */

const path = require('path');
const os = require('os');

// Socket and profile paths
const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock'); // Unix socket file path for client-daemon IPC communication
const PROFILE_PATH = path.join(os.homedir(), '.google-search-cli', 'profile'); // Persistent browser profile directory to maintain login sessions and preferences

// Daemon configuration
const DAEMON_PATH = path.resolve(__dirname, '..', 'daemon.js'); // Absolute path to daemon.js for spawning the background daemon process

// Timeouts (in milliseconds)
const IDLE_TIMEOUT = 300_000; // 5 minutes - daemon auto-shuts down after this period of inactivity to free resources
const NAV_TIMEOUT = 10000; // 10 seconds - max wait time for page navigation and initial load
const AI_WAIT_TIMEOUT = 5000; // 5 seconds - max wait time for AI response generation to complete

// Cache
const CACHE_MAX = 50; // Maximum number of search results to cache in memory for faster repeat queries

// Concurrency
const MAX_CONCURRENT = 3; // Maximum number of simultaneous search requests the daemon can process

// CDP blocked URLs (centralized)
const BLOCKED_URLS = [ // URL patterns to block via Chrome DevTools Protocol for faster page loads
    '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.svg', // Image files
    '*.woff', '*.woff2', '*.ttf', '*.otf', // Font files
    '*.mp4', '*.webm', '*.mp3', // Media files
    '*doubleclick*', '*google-analytics*', '*googlesyndication*', // Analytics and ads
    '*googleadservices*', '*facebook*', '*twitter*', '*linkedin*' // Social media trackers
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