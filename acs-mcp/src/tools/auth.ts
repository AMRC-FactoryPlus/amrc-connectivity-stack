/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServiceClient } from "@amrc-factoryplus/service-client";

/**
 * Register Auth service tools with the MCP server.
 * These tools are READ-ONLY and do not modify any data.
 */
export function registerAuthTools(
    server: McpServer,
    fplus: ServiceClient
): void {
    const auth = fplus.Auth;

    // list_principals - List all principal UUIDs
    server.tool(
        "list_principals",
        "List all principal UUIDs known to the Auth service.",
        {},
        async () => {
            try {
                const principals = await auth.list_principals();

                if (!principals || principals.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: "No principals found.",
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: `Found ${principals.length} principals:\n\n${principals.join("\n")}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error listing principals: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // find_principal - Find information about a principal
    server.tool(
        "find_principal",
        "Find information about a principal by Kerberos name, UUID, or Sparkplug address. Returns all known identities for the principal.",
        {
            kind: z.enum(["kerberos", "uuid", "sparkplug"]).describe("The type of identifier: 'kerberos', 'uuid', or 'sparkplug'"),
            identifier: z.string().describe("The identifier value (e.g., 'user@REALM' for Kerberos, a UUID, or 'group/node' for Sparkplug)"),
        },
        async ({ kind, identifier }) => {
            try {
                const principal = await auth.find_principal(kind, identifier);

                if (!principal) {
                    return {
                        content: [{
                            type: "text",
                            text: `No principal found for ${kind}: ${identifier}`,
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(principal, null, 2),
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error finding principal: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // check_acl - Check if a principal has a permission
    server.tool(
        "check_acl",
        "Check if a principal has a specific permission on a target. Returns true/false.",
        {
            principal: z.string().describe("The principal UUID to check"),
            permission: z.string().uuid().describe("The permission UUID to check"),
            target: z.string().uuid().describe("The target UUID to check"),
            wild: z.boolean().optional().describe("Whether to accept wildcard targets (default: false)"),
        },
        async ({ principal, permission, target, wild }) => {
            try {
                const hasPermission = await auth.check_acl(
                    { uuid: principal },
                    permission,
                    target,
                    wild ?? false
                );

                return {
                    content: [{
                        type: "text",
                        text: hasPermission
                            ? `✅ Principal ${principal} HAS permission ${permission} on target ${target}`
                            : `❌ Principal ${principal} does NOT have permission ${permission} on target ${target}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error checking ACL: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // list_grants - List all grant UUIDs
    server.tool(
        "list_grants",
        "List all permission grant UUIDs that we have access to read.",
        {},
        async () => {
            try {
                const grants = await auth.list_grants();

                if (!grants || grants.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: "No grants found (or no permission to read grants).",
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: `Found ${grants.length} grants:\n\n${grants.join("\n")}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error listing grants: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // get_grant - Get details of a specific grant
    server.tool(
        "get_grant",
        "Get the details of a specific permission grant by UUID.",
        {
            uuid: z.string().uuid().describe("The grant UUID to fetch"),
        },
        async ({ uuid }) => {
            try {
                const grant = await auth.get_grant(uuid);

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(grant, null, 2),
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error fetching grant: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // find_grants - Search for grants matching a pattern
    server.tool(
        "find_grants",
        "Search for permission grants matching a pattern. Returns grant UUIDs that match the provided principal, permission, and/or target.",
        {
            principal: z.string().uuid().optional().describe("Filter by principal UUID"),
            permission: z.string().uuid().optional().describe("Filter by permission UUID"),
            target: z.string().uuid().optional().describe("Filter by target UUID"),
        },
        async ({ principal, permission, target }) => {
            try {
                const pattern: Record<string, string> = {};
                if (principal) pattern.principal = principal;
                if (permission) pattern.permission = permission;
                if (target) pattern.target = target;

                const grants = await auth.find_grants(pattern);

                if (!grants || grants.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: "No grants found matching the pattern.",
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: `Found ${grants.length} matching grants:\n\n${grants.join("\n")}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error searching grants: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // whoami - Get current authenticated identity
    server.tool(
        "whoami",
        "Get the current authenticated identity (the service account running this MCP server).",
        {},
        async () => {
            try {
                const identity = await auth.whoami();

                return {
                    content: [{
                        type: "text",
                        text: `Current identity:\n\n${JSON.stringify(identity, null, 2)}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error fetching identity: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );
}
