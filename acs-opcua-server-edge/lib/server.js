/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ACS Edge OPC UA Server - OPC UA Server
 *
 * Creates an OPC UA server with an address space derived from the
 * configured UNS topics. Each topic path becomes a folder hierarchy
 * with the leaf as a Variable node. Values are served from the data
 * store, reporting null until a UNS message has been received.
 */

import {
    OPCUAServer,
    Variant,
    DataType,
    StatusCodes,
    DataValue,
    makeAccessLevelFlag,
    SecurityPolicy,
    MessageSecurityMode,
} from "node-opcua";

export class Server {
    constructor(opts) {
        this.topics = opts.topics;
        this.dataStore = opts.dataStore;
        this.port = opts.port;
        this.username = opts.username;
        this.password = opts.password;

        this.server = null;
    }

    async start() {
        this.server = new OPCUAServer({
            port: this.port,
            resourcePath: "/UA/ACSEdge",

            buildInfo: {
                productName: "ACS Edge OPC UA Server",
                buildNumber: "0.0.1",
                buildDate: new Date(),
            },

            /* For an edge deployment, certificate-based security is
             * not practical.  Allow anonymous connections and rely on
             * the username/password check. */
            securityPolicies: [SecurityPolicy.None],
            securityModes: [MessageSecurityMode.None],
            allowAnonymous: false,

            userManager: {
                isValidUser: (user, pass) => {
                    return user === this.username
                        && pass === this.password;
                },
            },
        });

        await this.server.initialize();
        this.buildAddressSpace();
        await this.server.start();

        const endpoint = this.server.getEndpointUrl();
        console.log(`OPC UA server listening at ${endpoint}`);
    }

    buildAddressSpace() {
        const addressSpace = this.server.engine.addressSpace;
        const ns = addressSpace.getOwnNamespace();

        /* For each topic, create the folder hierarchy and a variable
         * at the leaf.  Topic paths use / as separator, which maps
         * naturally to OPC UA folder structure. */
        for (const topic of this.topics) {
            const parts = topic.split("/");
            let parent = addressSpace.rootFolder.objects;

            /* Walk/create folders for all parts except the last. */
            for (let i = 0; i < parts.length - 1; i++) {
                const name = parts[i];
                const existing = parent.getFolderElements?.()?.find(
                    n => n.browseName.name === name);

                if (existing) {
                    parent = existing;
                }
                else {
                    parent = ns.addFolder(parent, {
                        browseName: name,
                        displayName: name,
                    });
                }
            }

            /* Create a variable node for the leaf. */
            const leafName = parts[parts.length - 1];
            const currentTopic = topic;

            ns.addVariable({
                componentOf: parent,
                browseName: leafName,
                displayName: leafName,
                description: `UNS topic: ${topic}`,
                dataType: DataType.Variant,
                accessLevel: makeAccessLevelFlag("CurrentRead"),

                value: {
                    timestamped_get: () => {
                        const entry = this.dataStore.get(currentTopic);

                        if (!entry) {
                            return new DataValue({
                                value: new Variant({
                                    dataType: DataType.Null,
                                }),
                                statusCode: StatusCodes.UncertainInitialValue,
                                sourceTimestamp: new Date(),
                                serverTimestamp: new Date(),
                            });
                        }

                        return new DataValue({
                            value: this.toVariant(entry.value),
                            statusCode: StatusCodes.Good,
                            sourceTimestamp: new Date(entry.timestamp),
                            serverTimestamp: new Date(),
                        });
                    },
                },
            });
        }
    }

    toVariant(value) {
        if (value === null || value === undefined) {
            return new Variant({ dataType: DataType.Null });
        }
        if (typeof value === "boolean") {
            return new Variant({ dataType: DataType.Boolean, value });
        }
        if (typeof value === "number") {
            if (Number.isInteger(value)) {
                return new Variant({ dataType: DataType.Int64, value });
            }
            return new Variant({ dataType: DataType.Double, value });
        }
        if (typeof value === "string") {
            return new Variant({ dataType: DataType.String, value });
        }
        /* For objects/arrays, serialise to JSON string. */
        return new Variant({
            dataType: DataType.String,
            value: JSON.stringify(value),
        });
    }

    async stop() {
        if (this.server) {
            await this.server.shutdown();
            console.log("OPC UA server stopped");
        }
    }
}
