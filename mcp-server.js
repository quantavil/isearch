#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const path = require('path');
const { search } = require(path.join(__dirname, 'lib', 'client'));

const server = new Server(
  { name: "isearch", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "google_search",
    description: "Search Google for real-time information, documentation, or current events.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" }
      },
      required: ["query"]
    }
  }]
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "google_search") {
    return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true };
  }

  const q = req.params.arguments?.query;
  if (!q) {
    return { content: [{ type: "text", text: "Query is required" }], isError: true };
  }

  try {
    const r = await search(q);

    if (r.error) {
      return { content: [{ type: "text", text: `Error: ${r.error}` }], isError: true };
    }

    let text = r.markdown || 'No results found.';
    if (r.timeMs != null) {
      text += `\n\n---\n_${r.timeMs}ms${r.fromCache ? ' (cached)' : ''}_`;
    }

    return { content: [{ type: "text", text }], isError: false };
  } catch (e) {
    return { content: [{ type: "text", text: `System error: ${e.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(e => {
  console.error('MCP error:', e);
  process.exit(1);
});