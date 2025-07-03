/*
 * Factory+ / AMRC Connectivity Stack (ACS) OPC UA Server component
 * OPC UA Server implementation
 * Copyright 2025 AMRC
 */

import {
    OPCUAServer,
    Variant,
    DataType,
    StatusCodes,
    AttributeIds,
    makeApplicationUrn,
    SecurityPolicy,
    MessageSecurityMode,
    UserTokenType,
    DataValue,
    TimestampsToReturn
} from "node-opcua";

import { Debug } from "@amrc-factoryplus/service-client";
import express from "express";

import { InfluxClient } from "./influx-client.js";
import { AddressSpaceBuilder } from "./address-space.js";
import { AuthHandler } from "./auth.js";

const debug = new Debug();

export class OPCUAServer {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.log = this.fplus.debug.bound("opcua-server");
        
        this.port = process.env.OPCUA_PORT || 4840;
        this.hostname = process.env.OPCUA_HOSTNAME || "0.0.0.0";
        this.httpPort = process.env.HTTP_PORT || 8080;

        this.influxClient = null;
        this.addressSpaceBuilder = null;
        this.authHandler = null;
        this.server = null;
        this.httpServer = null;
    }

    async init() {
        this.log("Initializing OPC UA Server...");

        // Initialize InfluxDB client
        this.influxClient = new InfluxClient({ fplus: this.fplus });
        await this.influxClient.init();

        // Initialize auth handler
        this.authHandler = new AuthHandler({ fplus: this.fplus });
        await this.authHandler.init();

        // Initialize address space builder
        this.addressSpaceBuilder = new AddressSpaceBuilder({ 
            fplus: this.fplus,
            influxClient: this.influxClient,
            authHandler: this.authHandler
        });

        // Create OPC UA server
        this.server = new OPCUAServer({
            port: this.port,
            hostname: this.hostname,
            
            resourcePath: "/UA/FactoryPlusUNS",
            buildInfo: {
                productName: "Factory+ UNS OPC UA Server",
                buildNumber: "1.0.0",
                buildDate: new Date()
            },
            
            serverInfo: {
                applicationUri: makeApplicationUrn(this.hostname, "FactoryPlusUNS"),
                productUri: "urn:amrc:factoryplus:opcua-server",
                applicationName: { text: "Factory+ UNS OPC UA Server", locale: "en" },
                applicationType: 0, // SERVER
                gatewayServerUri: null,
                discoveryProfileUri: null,
                discoveryUrls: []
            },

            // Security configuration
            securityPolicies: [
                SecurityPolicy.None,
                SecurityPolicy.Basic128Rsa15,
                SecurityPolicy.Basic256,
                SecurityPolicy.Basic256Sha256
            ],
            securityModes: [
                MessageSecurityMode.None,
                MessageSecurityMode.Sign,
                MessageSecurityMode.SignAndEncrypt
            ],

            // User authentication
            userManager: {
                isValidUser: this.authHandler.isValidUser.bind(this.authHandler),
                getUserRoles: this.authHandler.getUserRoles.bind(this.authHandler)
            },

            // Allow anonymous access (will be controlled by MQTT permissions)
            allowAnonymous: true
        });

        // Set up HTTP server for health checks
        this.setupHttpServer();

        this.log("OPC UA Server initialized");
    }

    async start() {
        this.log("Starting OPC UA Server...");

        // Start HTTP server first
        await this.startHttpServer();

        await this.server.initialize();

        // Build the address space
        await this.addressSpaceBuilder.buildAddressSpace(this.server.engine.addressSpace);

        // Set up data source handlers
        this.setupDataSources();

        await this.server.start();

        const endpoints = this.server.getEndpointUrl();
        this.log(`OPC UA Server started on ${endpoints}`);
        this.log(`HTTP management interface available on port ${this.httpPort}`);

        return endpoints;
    }

    async stop() {
        this.log("Stopping OPC UA Server...");

        if (this.server) {
            await this.server.shutdown();
        }

        if (this.httpServer) {
            this.httpServer.close();
        }

        if (this.influxClient) {
            await this.influxClient.close();
        }

        this.log("OPC UA Server stopped");
    }

    setupDataSources() {
        const addressSpace = this.server.engine.addressSpace;
        
        // Find all variable nodes in our namespace
        const namespace = addressSpace.getNamespace("urn:amrc:factoryplus:uns");
        if (!namespace) {
            this.log("Warning: Factory+ UNS namespace not found");
            return;
        }

        // Set up data source for all variable nodes
        namespace.nodeIterator((node) => {
            if (node.nodeClass === 2) { // Variable node
                this.setupVariableDataSource(node);
            }
        });
    }

    setupVariableDataSource(variableNode) {
        // Extract path information from the node
        const browsePath = this.getNodeBrowsePath(variableNode);
        
        variableNode.setValueFromSource({
            get: async () => {
                try {
                    const value = await this.influxClient.getCurrentValue(browsePath);
                    return new DataValue({
                        value: new Variant({
                            dataType: this.getDataType(value),
                            value: value
                        }),
                        statusCode: StatusCodes.Good,
                        sourceTimestamp: new Date()
                    });
                } catch (error) {
                    this.log(`Error reading value for ${browsePath}: ${error.message}`);
                    return new DataValue({
                        statusCode: StatusCodes.BadNoData
                    });
                }
            },
            
            timestamped_get: async () => {
                try {
                    const result = await this.influxClient.getTimestampedValue(browsePath);
                    return new DataValue({
                        value: new Variant({
                            dataType: this.getDataType(result.value),
                            value: result.value
                        }),
                        statusCode: StatusCodes.Good,
                        sourceTimestamp: result.timestamp,
                        serverTimestamp: new Date()
                    });
                } catch (error) {
                    this.log(`Error reading timestamped value for ${browsePath}: ${error.message}`);
                    return new DataValue({
                        statusCode: StatusCodes.BadNoData
                    });
                }
            }
        });
    }

    getNodeBrowsePath(node) {
        const path = [];
        let current = node;
        
        while (current && current.browseName && current.browseName.name !== "Objects") {
            if (current.browseName.name !== "Root") {
                path.unshift(current.browseName.name);
            }
            current = current.parent;
        }
        
        return path.join("/");
    }

    getDataType(value) {
        if (typeof value === "boolean") return DataType.Boolean;
        if (typeof value === "string") return DataType.String;
        if (Number.isInteger(value)) return DataType.Int32;
        if (typeof value === "number") return DataType.Double;
        return DataType.String; // Default fallback
    }

    setupHttpServer() {
        const app = express();

        // Health check endpoint
        app.get('/ping', (req, res) => {
            res.status(200).json({
                status: 'ok',
                service: 'acs-opcua-server',
                timestamp: new Date().toISOString(),
                opcua: {
                    running: this.server ? true : false,
                    endpoints: this.server ? this.server.getEndpointUrl() : null
                }
            });
        });

        // Status endpoint with more details
        app.get('/status', (req, res) => {
            res.status(200).json({
                service: 'acs-opcua-server',
                version: '1.0.0',
                timestamp: new Date().toISOString(),
                opcua: {
                    running: this.server ? true : false,
                    endpoints: this.server ? this.server.getEndpointUrl() : null,
                    port: this.port,
                    hostname: this.hostname
                },
                influx: {
                    connected: this.influxClient ? true : false,
                    url: process.env.INFLUX_URL,
                    bucket: process.env.INFLUX_BUCKET
                }
            });
        });

        this.httpApp = app;
    }

    async startHttpServer() {
        return new Promise((resolve, reject) => {
            this.httpServer = this.httpApp.listen(this.httpPort, (err) => {
                if (err) {
                    reject(err);
                } else {
                    this.log(`HTTP server listening on port ${this.httpPort}`);
                    resolve();
                }
            });
        });
    }
}
