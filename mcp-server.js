#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const net = require('net');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════

const SOCKET_PATH = path.join(os.tmpdir(), 'google-search-cli.sock');
const DAEMON_PATH = path.join(__dirname, 'daemon.js');

// ═══════════════════════════════════════════════════════════════
// DAEMON CLIENT LOGIC
// ═══════════════════════════════════════════════════════════════

function startDaemon() {
  return new Promise((resolve, reject) => {
    const daemon = spawn('node', [DAEMON_PATH], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env }
    });
    daemon.unref();

    const start = Date.now();
    const check = () => {
      if (Date.now() - start > 5000) return reject(new Error('Daemon failed to start'));
      const client = net.createConnection(SOCKET_PATH);
      client.on('connect', () => { client.end(); resolve(); });
      client.on('error', () => setTimeout(check, 100));
    };
    check();
  });
}

function queryDaemon(query) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(SOCKET_PATH);
    let buffer = '';

    client.on('connect', () => {
      client.write(JSON.stringify({ query }) + '\n');
    });

    client.on('data', chunk => buffer += chunk);

    client.on('end', () => {
      try {
        resolve(JSON.parse(buffer));
      } catch {
        reject(new Error('Invalid JSON from daemon'));
      }
    });

    client.on('error', reject);
  });
}

async function handleSearch(query) {
  try {
    return await queryDaemon(query);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
      // Daemon dead? Auto-start it.
      await startDaemon();
      return await queryDaemon(query);
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// MCP SERVER SETUP
// ═══════════════════════════════════════════════════════════════

const server = new Server(
  { name: "isearch", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [{
      name: "google_search",
      description: "Search Google to find real-time information, documentation, or fact-check data.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query (e.g., 'latest fedora release date')" }
        },
        required: ["query"]
      }
    }]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "google_search") {
    throw new Error(`Unknown tool: ${request.params.name}`);
  }

  const query = request.params.arguments.query;
  if (!query) throw new Error("Query is required");

  try {
    const result = await handleSearch(query);

    if (result.error) {
      return { content: [{ type: "text", text: `Search Error: ${result.error}` }], isError: true };
    }

    return {
      content: [{ type: "text", text: result.markdown || "No results found." }],
      isError: false
    };

  } catch (err) {
    return {
      content: [{ type: "text", text: `System Error: ${err.message}` }],
      isError: true
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});