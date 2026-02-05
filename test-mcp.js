#!/usr/bin/env node

const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = require("@modelcontextprotocol/sdk/client/stdio.js");
const path = require("path");

async function main() {
    const serverPath = path.join(__dirname, "mcp-server.js");

    const transport = new StdioClientTransport({
        command: "node",
        args: [serverPath],
    });

    const client = new Client(
        {
            name: "test-client",
            version: "1.0.0",
        },
        {
            capabilities: {},
        }
    );

    console.log("Connecting to MCP server...");
    await client.connect(transport);

    console.log("Listing tools...");
    const tools = await client.listTools();
    console.log("Tools available:", JSON.stringify(tools, null, 2));

    console.log("Calling google_search tool with query 'what is svelte 5'...");
    const result = await client.callTool({
        name: "google_search",
        arguments: {
            query: "what is svelte 5",
        },
    });

    console.log("Result received:");
    console.log(result.content[0].text);

    process.exit(0);
}

main().catch((error) => {
    console.error("Test failed:", error);
    process.exit(1);
});
