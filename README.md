# iSearch - High-Performance Google Search CLI & MCP

A blazing fast, anti-bot Google Search scraper using Playwright. It utilizes a **Daemon/Client architecture** to keep a browser instance warm, utilizing persistent profiles and aggressive C++ level resource blocking for instant results.

## Features

- **Daemon Architecture**: Background process keeps a tab ready. Zero startup latency for subsequent searches.
- **Aggressive Optimization**: Uses CDP (Chrome DevTools Protocol) to block images, fonts, and ads at the browser engine level.
- **Race-Condition Free**: Supports rapid-fire queries via Tab Pooling.
- **Stealth**: Persistent profile with randomized fingerprints to evade bot detection.
- **MCP Support**: Works seamlessly with Claude Desktop, Cursor, and other AI agents.

## Installation

### 1. Clone & Install
```bash
git clone [https://github.com/quantavil/isearch.git](https://github.com/quantavil/isearch.git)
cd isearch
npm install

```

### 2. Setup Profile (Important)

Run this once to log in to Google. This saves your cookies so you don't hit CAPTCHAs later.

```bash
npm run setup

```

*A browser will open. Log in to Google, then close the window manually.*

### 3. Link Command (Fedora/Linux)

Make the `ask` command available globally:

```bash
chmod +x ask.js daemon.js mcp-server.js
ln -sf "$(pwd)/ask.js" ~/.local/bin/ask

```

## Usage

### CLI

Search directly from your terminal. The daemon will auto-start if needed.

```bash
ask "best fedora kde themes 2025"

```

**Commands:**

* `ask "query"` : Search Google.
* `ask --status` : Check if the background daemon is running.
* `ask --stop` : Kill the background daemon.

### MCP Server (AI Agent Integration)

Add this tool to your `mcp_config.json` (for Claude/Cursor/etc).

**Configuration:**

```json
{
  "mcpServers": {
    "isearch": {
      "command": "node",
      "args": ["/absolute/path/to/isearch/mcp-server.js"]
    }
  }
}

```

*Note: The MCP server communicates with the same background daemon as the CLI. If you search in CLI, your AI agent gets the benefit of the warmed-up cache.*

## Troubleshooting

**"Profile Locked" or Singleton Error:**
If the browser crashes, a lock file might remain.

1. Run `ask --stop`
2. If that fails, run `pkill -f chrome`

**"CAPTCHA Detected":**
Google has flagged your IP.

1. Run `npm run setup`
2. Solve the CAPTCHA manually in the window.
3. Close the window and retry.

## License

MIT

