/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ServiceClient } from "@amrc-factoryplus/service-client";

// Well-known UUIDs from Factory+ specification
const App = {
    Registration: "cb40bed5-49ad-4443-a7f5-08c75009da8f",
    Info: "64a8bfa9-7772-45c4-9d1a-9e6290690957",
};

const Class = {
    App: "d319bd87-f42b-4b66-be4f-f82ff48b93f0",
};

/**
 * Register ConfigDB tools with the MCP server.
 */
export function registerConfigDBTools(
    server: McpServer,
    fplus: ServiceClient
): void {
    const configdb = fplus.ConfigDB;

    // list_apps - List all registered applications
    server.tool(
        "list_apps",
        "List all registered applications in ConfigDB. Returns application UUIDs that can be used with other ConfigDB tools.",
        {},
        async () => {
            try {
                const apps = await configdb.class_members(Class.App);

                if (!apps || apps.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: "No applications found.",
                        }],
                    };
                }

                // Fetch info for each app to provide useful context
                const appInfos = await Promise.all(
                    apps.map(async (uuid: string) => {
                        const info = await configdb.get_config(App.Info, uuid);
                        return {
                            uuid,
                            name: (info?.name as string) ?? "(unnamed)",
                        };
                    })
                );

                const formatted = appInfos
                    .map((app: { uuid: string; name: string }) => `- ${app.name}: ${app.uuid}`)
                    .join("\n");

                return {
                    content: [{
                        type: "text",
                        text: `Found ${apps.length} applications:\n\n${formatted}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error listing applications: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // get_config - Fetch a config entry
    server.tool(
        "get_config",
        "Fetch a configuration entry from ConfigDB by application UUID and object UUID.",
        {
            app: z.string().uuid().describe("The application UUID (identifies the type of config)"),
            object: z.string().uuid().describe("The object UUID to fetch config for"),
        },
        async ({ app, object }) => {
            try {
                const config = await configdb.get_config(app, object);

                if (config === undefined) {
                    return {
                        content: [{
                            type: "text",
                            text: `No configuration found for app ${app}, object ${object}`,
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(config, null, 2),
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error fetching config: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // list_configs - List all objects for an application
    server.tool(
        "list_configs",
        "List all object UUIDs that have configuration entries for a given application.",
        {
            app: z.string().uuid().describe("The application UUID to list configs for"),
        },
        async ({ app }) => {
            try {
                const objects = await configdb.list_configs(app);

                if (!objects || objects.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: `No configuration entries found for application ${app}`,
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: `Found ${objects.length} objects with config for app ${app}:\n\n${objects.join("\n")}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error listing configs: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // search_configs - Search for config entries
    server.tool(
        "search_configs",
        "Search for configuration entries matching a query pattern. The query is an object where keys are JSONPath expressions and values are the values to match.",
        {
            app: z.string().uuid().describe("The application UUID to search within"),
            query: z.record(z.unknown()).describe("Query object: keys are JSONPath expressions, values are scalars to match"),
            klass: z.string().uuid().optional().describe("Optional: restrict search to objects in this class"),
        },
        async ({ app, query, klass }) => {
            try {
                const results = await configdb.search({
                    app,
                    query,
                    ...(klass && { klass }),
                });

                if (!results || results.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: "No matching entries found.",
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: `Found ${results.length} matching objects:\n\n${JSON.stringify(results, null, 2)}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error searching configs: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // get_class_members - List members of a class
    server.tool(
        "get_class_members",
        "List all members of a class (recursively includes subclass members).",
        {
            klass: z.string().uuid().describe("The class UUID to list members for"),
        },
        async ({ klass }) => {
            try {
                const members = await configdb.class_members(klass);

                if (!members || members.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: `No members found for class ${klass}`,
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: `Found ${members.length} members of class ${klass}:\n\n${members.join("\n")}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error listing class members: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // get_class_subclasses - List subclasses of a class
    server.tool(
        "get_class_subclasses",
        "List all subclasses of a class (recursively).",
        {
            klass: z.string().uuid().describe("The class UUID to list subclasses for"),
        },
        async ({ klass }) => {
            try {
                const subclasses = await configdb.class_subclasses(klass);

                if (!subclasses || subclasses.length === 0) {
                    return {
                        content: [{
                            type: "text",
                            text: `No subclasses found for class ${klass}`,
                        }],
                    };
                }

                return {
                    content: [{
                        type: "text",
                        text: `Found ${subclasses.length} subclasses of class ${klass}:\n\n${subclasses.join("\n")}`,
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error listing subclasses: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );

    // get_object_info - Get object registration info
    server.tool(
        "get_object_info",
        "Get the registration information for an object, including its name and class membership.",
        {
            object: z.string().uuid().describe("The object UUID to get info for"),
        },
        async ({ object }) => {
            try {
                // Fetch both registration and general info
                const [registration, info] = await Promise.all([
                    configdb.get_config(App.Registration, object),
                    configdb.get_config(App.Info, object),
                ]);

                if (!registration && !info) {
                    return {
                        content: [{
                            type: "text",
                            text: `No information found for object ${object}`,
                        }],
                    };
                }

                const result = {
                    uuid: object,
                    ...(info && { info }),
                    ...(registration && { registration }),
                };

                return {
                    content: [{
                        type: "text",
                        text: JSON.stringify(result, null, 2),
                    }],
                };
            } catch (error) {
                return {
                    content: [{
                        type: "text",
                        text: `Error fetching object info: ${error instanceof Error ? error.message : String(error)}`,
                    }],
                    isError: true,
                };
            }
        }
    );
}
