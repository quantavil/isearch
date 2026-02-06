#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const path = require('path');
const { search } = require(path.join(__dirname, 'lib', 'client'));

// ═══════════════════════════════════════════════════════════════
// MCP SERVER
// ═══════════════════════════════════════════════════════════════

const server = new Server(
  { name: "isearch", version: "2.0.0" },
  { capabilities: { tools: {} } }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: "google_search",
    description: "Search Google for real-time information. Returns AI-generated summaries when available, otherwise standard search results. Use for current events, documentation, fact-checking, or any information that may have changed since training.",
    inputSchema: {
      type: "object",
      properties: {
        query: { 
          type: "string", 
          description: "The search query (e.g., 'latest node.js version', 'how to use react hooks')" 
        }
      },
      required: ["query"]
    }
  }]
}));

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name !== "google_search") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true
    };
  }

  const query = args?.query;
  if (!query || typeof query !== 'string') {
    return {
      content: [{ type: "text", text: "Error: 'query' parameter is required and must be a string" }],
      isError: true
    };
  }

  try {
    const result = await search(query);

    if (result.error) {
      return {
        content: [{ type: "text", text: `Search Error: ${result.error}` }],
        isError: true
      };
    }

    // Format response with metadata
    let response = result.markdown || "No results found.";
    
    // Add metadata footer
    const metaParts = [];
    if (result.timeMs !== undefined) metaParts.push(`${result.timeMs}ms`);
    if (result.fromCache) metaParts.push('cached');
    
    if (metaParts.length > 0) {
      response += `\n\n---\n_Fetched in ${metaParts.join(', ')}_`;
    }

    return {
      content: [{ type: "text", text: response }],
      isError: false
    };

  } catch (err) {
    return {
      content: [{ type: "text", text: `System Error: ${err.message}` }],
      isError: true
    };
  }
});

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error("MCP Server Error:", err);
  process.exit(1);
});