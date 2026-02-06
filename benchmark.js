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
        { name: "benchmark-client", version: "1.0.0" },
        { capabilities: {} }
    );

    console.log("Connecting to MCP server...");
    await client.connect(transport);

    const queries = ["what is svelte 5", "what is svelte 5", "current time in London"];

    for (const query of queries) {
        console.log(`\nTesting query: "${query}"`);
        const start = Date.now();
        const result = await client.callTool({
            name: "google_search",
            arguments: { query },
        });
        const elapsed = Date.now() - start;
        const fromCache = result.content[0].text.includes("Cache hit") || (elapsed < 500); // Rough heuristic if not explicitly logged in output

        console.log(`Elapsed: ${elapsed}ms ${fromCache ? "(likely CACHED)" : "(UNCACHED)"}`);
        // console.log("Result preview:", result.content[0].text.substring(0, 100).replace(/\n/g, ' ') + "...");
    }

    process.exit(0);
}

main().catch((error) => {
    console.error("Benchmark failed:", error);
    process.exit(1);
});
