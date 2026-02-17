/*
 * Copyright (c) University of Sheffield AMRC 2026.
 */

/*
 * ACS Edge OPC UA Server - OPC UA Server
 *
 * Creates an OPC UA server with a dynamic address space. Topic paths
 * are mapped to an OPC UA folder hierarchy with Variable nodes at the
 * leaves. Nodes are created on the fly as new topics arrive from the
 * data store, supporting MQTT wildcard subscriptions.
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
    OPCUACertificateManager,
} from "node-opcua";

export class Server {
    constructor(opts) {
        this.dataStore = opts.dataStore;
        this.port = opts.port;
        this.username = opts.username;
        this.password = opts.password;
        this.allowAnonymous = opts.allowAnonymous ?? false;

        this.server = null;
        /* Track which topics already have OPC UA variable nodes. */
        this.variables = new Map();
    }

    async start() {
        /* Both certificate managers must use the writable /data volume.
         * Without an explicit userCertificateManager node-opcua will
         * try to create one under ~/.config which is read-only in the
         * container image. */
        const serverCertificateManager = new OPCUACertificateManager({
            automaticallyAcceptUnknownCertificate: true,
            rootFolder: "/data/pki/server",
        });
        const userCertificateManager = new OPCUACertificateManager({
            automaticallyAcceptUnknownCertificate: true,
            rootFolder: "/data/pki/user",
        });

        this.server = new OPCUAServer({
            port: this.port,
            resourcePath: "/UA/ACSEdge",

            buildInfo: {
                productName: "ACS Edge OPC UA Server",
                buildNumber: "0.0.1",
                buildDate: new Date(),
            },

            serverCertificateManager,
            userCertificateManager,

            /* For an edge deployment, certificate-based security is
             * not practical. We still need SignAndEncrypt with a real
             * security policy so that username/password tokens can be
             * transmitted securely. SecurityPolicy.None is kept so
             * that anonymous browsing without encryption is possible
             * when allowAnonymous is true. */
            securityPolicies: [
                SecurityPolicy.None,
                SecurityPolicy.Basic256Sha256,
            ],
            securityModes: [
                MessageSecurityMode.None,
                MessageSecurityMode.SignAndEncrypt,
            ],
            allowAnonymous: this.allowAnonymous,

            userManager: {
                isValidUser: (user, pass) => {
                    return user === this.username
                        && pass === this.password;
                },
            },
        });

        await this.server.initialize();

        this.addressSpace = this.server.engine.addressSpace;
        this.ns = this.addressSpace.getOwnNamespace();

        /* Create nodes for any values already in the data store
         * (e.g. restored from the persistent cache). */
        for (const topic of this.dataStore.topics()) {
            this.ensureVariable(topic);
        }

        /* Dynamically create nodes as new topics arrive. */
        this.dataStore.on("change", (topic, entry) => {
            const variable = this.ensureVariable(topic);
            variable.setValueFromSource(
                this.toVariant(entry.value),
                StatusCodes.Good,
                new Date(entry.timestamp),
            );
        });

        await this.server.start();

        const endpoint = this.server.getEndpointUrl();
        console.log(`OPC UA server listening at ${endpoint}`);
    }

    /* Ensure a topic has a corresponding OPC UA variable node,
     * creating the folder hierarchy and variable if needed. */
    ensureVariable(topic) {
        if (this.variables.has(topic)) {
            return this.variables.get(topic);
        }

        const parts = topic.split("/");
        let parent = this.addressSpace.rootFolder.objects;

        /* Walk/create folders for all parts except the last. */
        for (let i = 0; i < parts.length - 1; i++) {
            const name = parts[i];
            const existing = parent.getFolderElements?.()?.find(
                n => n.browseName.name === name);

            if (existing) {
                parent = existing;
            }
            else {
                parent = this.ns.addFolder(parent, {
                    browseName: name,
                    displayName: name,
                });
            }
        }

        const leafName = parts[parts.length - 1];

        const entry = this.dataStore.get(topic);
        const initValue = entry
            ? new DataValue({
                value: this.toVariant(entry.value),
                statusCode: StatusCodes.Good,
                sourceTimestamp: new Date(entry.timestamp),
                serverTimestamp: new Date(),
            })
            : new DataValue({
                value: new Variant({ dataType: DataType.Null }),
                statusCode: StatusCodes.UncertainInitialValue,
                sourceTimestamp: new Date(),
                serverTimestamp: new Date(),
            });

        const variable = this.ns.addVariable({
            componentOf: parent,
            browseName: leafName,
            displayName: leafName,
            description: `UNS topic: ${topic}`,
            dataType: DataType.Variant,
            accessLevel: makeAccessLevelFlag("CurrentRead"),
            value: initValue,
            minimumSamplingInterval: 0,
        });

        this.variables.set(topic, variable);
        console.log(`New OPC UA variable: ${topic}`);
        return variable;
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
