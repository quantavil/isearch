
# iSearch - High-Performance Google Search CLI & MCP

A blazing fast, anti-bot Google Search scraper using Playwright. It utilizes a **Daemon/Client architecture** to keep a browser instance warm, utilizing persistent profiles and aggressive CDP-level resource blocking for instant results.

## Features

- **Daemon Architecture**: Background process keeps a browser ready. Zero startup latency for subsequent searches.
- **Aggressive Optimization**: Uses CDP (Chrome DevTools Protocol) to block images, fonts, and ads at the browser engine level.
- **Concurrency Safe**: Supports rapid-fire queries via tab concurrency limiting.
- **Headless/Headed Toggle**: Switch between headless and visible browser on-the-fly for debugging.
- **Stealth**: Persistent profile with randomized fingerprints to evade bot detection.
- **MCP Support**: Works seamlessly with Claude Desktop, Cursor, and other AI agents.

## Installation

### 1. Clone & Install
```bash
git clone https://github.com/quantavil/isearch.git
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

| Command | Description |
|---|---|
| `ask "query"` | Search Google (headless) |
| `ask --head "query"` | Search with a visible browser window |
| `ask --head` | Restart daemon in headed mode (no query) |
| `ask --headless` | Restart daemon in headless mode |
| `ask --status` | Check daemon status and current mode |
| `ask --stop` | Kill the background daemon |

**Examples:**

```bash
# Normal search
ask "what is rust"

# Debug a CAPTCHA — see the browser
ask --head "latest node.js version"

# Switch back to headless
ask --headless

# Or use environment variable
HEADLESS=false ask "some query"
```

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

*The MCP server communicates with the same background daemon as the CLI.*

## Testing

```bash
# Integration tests (starts daemon if needed)
npm test

# MCP protocol test
npm run test:mcp

# Stop daemon after tests
npm test -- --stop
```

## Troubleshooting

**"Profile Locked" or Singleton Error:**
If the browser crashes, a lock file might remain.

1. Run `ask --stop`
2. If that fails, run `pkill -f chrome`

**"CAPTCHA Detected":**
Google has flagged your IP.

1. Run `ask --head "test"` to see what's happening
2. Or run `npm run setup` and solve the CAPTCHA manually
3. Close the window and retry

**Daemon won't switch modes:**
The daemon must fully stop before restarting in a new mode. If `ask --head` hangs:

1. `ask --stop`
2. `ask --head "your query"`

## License

MIT
