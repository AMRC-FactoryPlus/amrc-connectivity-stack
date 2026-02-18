/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServiceClient } from "@amrc-factoryplus/service-client";

/**
 * Register Directory service tools with the MCP server.
 * These tools are READ-ONLY and do not modify any data.
 */
export function registerDirectoryTools(
    server: McpServer,
    fplus: ServiceClient
): void {
    const directory = fplus.Directory;

    // get_device_info - Get full device record
    server.tool(
        "get_device_info",
        "Get detailed information about a Sparkplug device including its address, schemas, and online status.",
        {
            device: z.string().uuid().describe("The device UUID to look up"),
        },
        async ({ device }) => {
            try {
                const info = await directory.get_device_info(device);

                if (!info) {
                    return {
                        content: [{
                            type: "text",
                            text: `Device ${device} not found in the Directory.`,
                        }],
                    };
                }

                const status = info.online ? "🟢 Online" : "🔴 Offline";
                const address = info.device_id
                    ? `${info.group_id}/${info.node_id}/${info.device_id}`
                    : `${info.group_id}/${info.node_id}`;

                const output = [
                    `**Device:** ${device}`,
                    `**Status:** ${status}`,
                    `**Sparkplug Address:** ${address}`,
                    `**Top Schema:** ${info.top_schema || "None"}`,
                    `**Last Change:** ${info.last_change ? new Date(info.last_change).toISOString() : "Unknown"}`,
                    `**All Schemas:** ${info.schemas?.length ? info.schemas.join(", ") : "None"}`,
                ].join("\n");

                return {
                    content: [{
                        type: "text",
                        text: output,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error getting device info: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // get_device_address - Get Sparkplug address for a device
    server.tool(
        "get_device_address",
        "Get the Sparkplug address (group/node/device) for a device UUID.",
        {
            device: z.string().uuid().describe("The device UUID to look up"),
        },
        async ({ device }) => {
            try {
                const address = await directory.get_device_address(device);

                if (!address) {
                    return {
                        content: [{
                            type: "text",
                            text: `Device ${device} not found in the Directory.`,
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: `Sparkplug Address: ${address.toString()}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error getting device address: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // get_service_info - Get full service registration
    server.tool(
        "get_service_info",
        "Get the full service registration including HTTP URL and Sparkplug device for a service function UUID.",
        {
            service: z.string().uuid().describe("The service function UUID to look up"),
        },
        async ({ service }) => {
            try {
                const info = await directory.get_service_info(service);

                if (!info) {
                    return {
                        content: [{
                            type: "text",
                            text: `Service ${service} not registered in the Directory.`,
                        }],
                    };
                }

                const output = [
                    `**Service:** ${service}`,
                    info.url ? `**HTTP URL:** ${info.url}` : "**HTTP URL:** Not available",
                    info.device ? `**Sparkplug Device:** ${info.device}` : "**Sparkplug Device:** None",
                ].join("\n");

                return {
                    content: [{
                        type: "text",
                        text: output,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error getting service info: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // get_service_url - Get just the URL for a service
    server.tool(
        "get_service_url",
        "Get the HTTP endpoint URL for a service function UUID.",
        {
            service: z.string().uuid().describe("The service function UUID to look up"),
        },
        async ({ service }) => {
            try {
                const url = await directory.get_service_url(service);

                if (!url) {
                    return {
                        content: [{
                            type: "text",
                            text: `No URL registered for service ${service}.`,
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: `Service URL: ${url}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error getting service URL: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );
}
