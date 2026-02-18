/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const DOCS_REPO = "AMRC-FactoryPlus/amrc-connectivity-stack";
const DOCS_BRANCH = "main";
const DOCS_PATH = "docs";

interface GitHubSearchResult {
    items: Array<{
        name: string;
        path: string;
        html_url: string;
        repository: { full_name: string };
    }>;
}

interface GitHubContent {
    name: string;
    path: string;
    content?: string;
    encoding?: string;
    type: string;
    html_url: string;
}

/**
 * Register documentation tools with the MCP server.
 */
export function registerDocsTools(server: McpServer): void {

    // search_docs - Search ACS documentation on GitHub
    server.tool(
        "search_docs",
        "Search the ACS documentation on GitHub for a given query. Returns matching file paths and snippets.",
        {
            query: z.string().describe("Search query to find in ACS documentation"),
        },
        async ({ query }) => {
            try {
                // Use GitHub code search API
                const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(query)}+repo:${DOCS_REPO}+path:${DOCS_PATH}`;

                const response = await fetch(searchUrl, {
                    headers: {
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "acs-mcp-server",
                    },
                });

                if (!response.ok) {
                    if (response.status === 403) {
                        return {
                            content: [{
                                type: "text",
                                text: "GitHub API rate limit exceeded. Try again later or provide a GITHUB_TOKEN environment variable.",
                            }],
                            isError: true,
                        };
                    }
                    throw new Error(`GitHub API error: ${response.status}`);
                }

                const data = await response.json() as GitHubSearchResult;

                if (!data.items || data.items.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: `No documentation found matching "${query}".`,
                        }],
                    };
                }

                const results = data.items.slice(0, 10).map((item) =>
                    `- [${item.name}](${item.html_url})\n  Path: ${item.path}`
                ).join("\n\n");

                return {
                    content: [{
                        type: "text",
                        text: `Found ${data.items.length} matching docs for "${query}":\n\n${results}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error searching docs: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // list_docs - List all documentation files
    server.tool(
        "list_docs",
        "List all available ACS documentation files from GitHub.",
        {
            path: z.string().optional().describe("Optional subdirectory path within docs (e.g., 'architecture', 'concepts')"),
        },
        async ({ path }) => {
            try {
                const docsPath = path ? `${DOCS_PATH}/${path}` : DOCS_PATH;
                const url = `https://api.github.com/repos/${DOCS_REPO}/contents/${docsPath}?ref=${DOCS_BRANCH}`;

                const response = await fetch(url, {
                    headers: {
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "acs-mcp-server",
                    },
                });

                if (!response.ok) {
                    if (response.status === 404) {
                        return {
                            content: [{
                                type: "text",
                                text: `Path not found: ${docsPath}`,
                            }],
                            isError: true,
                        };
                    }
                    throw new Error(`GitHub API error: ${response.status}`);
                }

                const contents = await response.json() as GitHubContent[];

                const items = contents.map((item) => {
                    const icon = item.type === "dir" ? "📁" : "📄";
                    return `${icon} ${item.name}`;
                }).join("\n");

                return {
                    content: [{
                        type: "text",
                        text: `Contents of ${docsPath}:\n\n${items}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error listing docs: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // read_doc - Read a specific documentation file
    server.tool(
        "read_doc",
        "Read the contents of a specific ACS documentation file from GitHub.",
        {
            path: z.string().describe("Path to the doc file relative to docs/ (e.g., 'architecture/overview.md')"),
        },
        async ({ path }) => {
            try {
                const fullPath = path.startsWith("docs/") ? path : `${DOCS_PATH}/${path}`;
                const url = `https://api.github.com/repos/${DOCS_REPO}/contents/${fullPath}?ref=${DOCS_BRANCH}`;

                const response = await fetch(url, {
                    headers: {
                        "Accept": "application/vnd.github.v3+json",
                        "User-Agent": "acs-mcp-server",
                    },
                });

                if (!response.ok) {
                    if (response.status === 404) {
                        return {
                            content: [{
                                type: "text",
                                text: `Documentation file not found: ${fullPath}`,
                            }],
                            isError: true,
                        };
                    }
                    throw new Error(`GitHub API error: ${response.status}`);
                }

                const data = await response.json() as GitHubContent;

                if (data.type !== "file" || !data.content) {
                    return {
                        content: [{
                            type: "text",
                            text: `${fullPath} is not a file or has no content.`,
                        }],
                        isError: true,
                    };
                }

                // Decode base64 content
                const content = Buffer.from(data.content, "base64").toString("utf-8");

                return {
                    content: [{
                        type: "text",
                        text: `# ${data.name}\n\n${content}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error reading doc: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // ===== Factory+ Portal Tools =====
    const PORTAL_BASE = "https://factoryplus.app.amrc.co.uk";

    // search_portal - Search Factory+ portal documentation
    server.tool(
        "search_portal",
        "Search the Factory+ public documentation portal for information about the framework. Factory+ is the framework that ACS implements.",
        {
            query: z.string().describe("Search query to find in Factory+ documentation"),
        },
        async ({ query }) => {
            try {
                // Fetch the search index
                const indexUrl = `${PORTAL_BASE}/search-index.json`;
                const response = await fetch(indexUrl, {
                    headers: { "User-Agent": "acs-mcp-server" },
                });

                if (!response.ok) {
                    throw new Error(`Failed to fetch search index: ${response.status}`);
                }

                const searchIndex = await response.json() as Array<{ documents: Array<{ t: string; u: string; b?: string[] }> }>;

                // Simple text search through document titles
                const queryLower = query.toLowerCase();
                const matches: Array<{ title: string; url: string; breadcrumbs: string }> = [];

                for (const section of searchIndex) {
                    if (!section.documents) continue;
                    for (const doc of section.documents) {
                        if (doc.t && doc.t.toLowerCase().includes(queryLower)) {
                            matches.push({
                                title: doc.t,
                                url: `${PORTAL_BASE}${doc.u}`,
                                breadcrumbs: doc.b?.join(" > ") || "",
                            });
                        }
                    }
                }

                if (matches.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: `No Factory+ documentation found matching "${query}".`,
                        }],
                    };
                }

                const results = matches.slice(0, 15).map((m) =>
                    `- **${m.title}**${m.breadcrumbs ? ` (${m.breadcrumbs})` : ""}\n  ${m.url}`
                ).join("\n\n");

                return {
                    content: [{
                        type: "text",
                        text: `Found ${matches.length} Factory+ docs matching "${query}":\n\n${results}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error searching portal: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // read_portal_page - Read a specific Factory+ portal page
    server.tool(
        "read_portal_page",
        "Read content from a specific Factory+ documentation portal page.",
        {
            path: z.string().describe("Path to the page (e.g., '/docs/framework-components/central/authorisation')"),
        },
        async ({ path }) => {
            try {
                const url = path.startsWith("http") ? path : `${PORTAL_BASE}${path}`;

                const response = await fetch(url, {
                    headers: { "User-Agent": "acs-mcp-server" },
                });

                if (!response.ok) {
                    return {
                        content: [{
                            type: "text",
                            text: `Page not found: ${url}`,
                        }],
                        isError: true,
                    };
                }

                const html = await response.text();

                // Extract main content (simple extraction)
                // Look for the article content
                const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
                let content = articleMatch ? articleMatch[1] : html;

                // Strip HTML tags for a simpler text output
                content = content
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
                    .replace(/<[^>]+>/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();

                // Truncate if too long
                if (content.length > 8000) {
                    content = content.substring(0, 8000) + "\n\n[Content truncated...]";
                }

                return {
                    content: [{
                        type: "text",
                        text: `# ${path}\n\nSource: ${url}\n\n${content}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error reading portal page: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );
}

