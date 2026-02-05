# iSearch - Fast Google Search CLI & MCP Server

A fast, anti-bot Google Search scraper using Playwright. It leverages persistent browser profiles and aggressive resource blocking to provide quick search results in Markdown format.

## Features

- **Fast & Efficient**: Uses a single persistent browser instance with resource blocking (CSS, images, fonts, etc.) to minimize load times.
- **Anti-Bot Detection**: Uses persistent profiles and stealth scripts to avoid detection.
- **Markdown Output**: Converts search results directly into clean Markdown using Cheerio and Turndown.
- **MCP Server**: Compatible with the Model Context Protocol (MCP), allowing AI agents to use it as a tool.
- **Local Daemon**: Runs as a background service with a Unix socket for fast communication.

## Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/quantavil/isearch.git
    cd isearch
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Setup Google Profile**:
    Run the setup script once to create a persistent browser profile. This might require you to solve a CAPTCHA if prompted.
    ```bash
    npm run setup
    ```

## Usage

### CLI
You can search directly from the command line:
```bash
./ask.js "How to bake a chocolate cake"
```

### Daemon
Start the daemon in the background:
```bash
node daemon.js
```

### MCP Server
(Coming soon/Implemented) 
To use this as an MCP server, add it to your `mcp_config.json`:
```json
{
  "mcpServers": {
    "isearch": {
      "command": "node",
      "args": ["/path/to/isearch/mcp-server.js"]
    }
  }
}
```

## Configuration

- `IDLE_TIMEOUT`: Closes the browser after a period of inactivity.
- `CACHE_TTL`: Caches results for a specified duration.
- `DEBUG`: Set to `1` to see browser output and logs.

## License

MIT
