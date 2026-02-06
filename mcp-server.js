#!/usr/bin/env node

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { search, initBrowser, shutdown } = require("./daemon.js");

const server = new Server(
    {
        name: "isearch",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

/**
 * Handle listing available tools.
 * The server exposes a single tool: google_search.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "google_search",
                description: "Search Google and get results in clean Markdown format. Useful for finding up-to-date information, documentation, and answers to complex questions.",
                inputSchema: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "The search query",
                        },
                    },
                    required: ["query"],
                },
            },
        ],
    };
});

/**
 * Handle tool calls.
 * For google_search, it uses the refactored search logic from daemon.js.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== "google_search") {
        throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const query = request.params.arguments.query;
    if (!query) {
        throw new Error("Query is required");
    }

    try {
        const { markdown, fromCache, error } = await search(query);

        if (error) {
            return {
                content: [{ type: "text", text: `Error: ${error}` }],
                isError: true,
            };
        }

        if (!markdown) {
            return {
                content: [{ type: "text", text: "No results found." }],
                isError: false,
            };
        }

        return {
            content: [
                {
                    type: "text",
                    text: markdown,
                },
            ],
            isError: false,
        };
    } catch (err) {
        return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
        };
    }
});

/**
 * Start the server using stdio transport.
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("iSearch MCP server running on stdio");
}

main().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
});

// Handle graceful shutdown
process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
});

process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
});