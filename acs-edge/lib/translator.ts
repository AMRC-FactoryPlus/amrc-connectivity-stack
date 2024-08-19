/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {EventEmitter} from "events";
import fs from "fs";
import timers from "timers/promises";
import util from "util";

import type {Identity} from "@amrc-factoryplus/utilities";
import {ServiceClient} from "@amrc-factoryplus/utilities";

/* XXX These need to be incorporated into the main codebase. The config
 * rehashing just needs to go: the code which uses the config needs
 * adapting to accept the correct format. */
import {validateConfig} from '../utils/CentralConfig.js';
import {reHashConf} from "../utils/FormatConfig.js";

import {Device, deviceOptions} from "./device.js";
import {DriverBroker} from "./driverBroker.js";
import {SparkplugNode} from "./sparkplugNode.js";
import * as UUIDs from "./uuids.js";

import {log} from "./helpers/log.js";
import {sparkplugConfig,} from "./helpers/typeHandler.js";

import {RestConnection} from "./devices/REST.js";
import {S7Connection} from "./devices/S7.js";
import {OPCUAConnection} from "./devices/OPCUA.js";
import {MQTTConnection} from "./devices/MQTT.js";
import {UDPConnection} from "./devices/UDP.js";
import {WebsocketConnection} from "./devices/websocket.js";
import {MTConnectConnection} from "./devices/MTConnect.js";
import {EtherNetIPConnection} from "./devices/EtherNetIP.js";
import {DriverConnection} from "./devices/driver.js";

/**
 * Translator class basically turns config file into instantiated classes
 * for device protocol translation and Sparkplug communication
 */

export interface translatorConf {
    sparkplug: Partial<sparkplugConfig>,
    deviceConnections?: any[]
}

interface deviceInfo {
    connection: any;
    connectionDetails: any
}

export class Translator extends EventEmitter {
    /**
     * Class constructor - Unpacks config file and defines helpful class attributes
     * @param {Object} conf Config file from web UI
     */
    sparkplugNode!: SparkplugNode
    fplus: ServiceClient
    broker: DriverBroker
    pollInt: number

    connections: {
        [index: string]: any
    }
    devices: {
        [index: string]: any
    }

    constructor(fplus: ServiceClient, pollInt: number, broker: DriverBroker) {
        super();

        this.fplus = fplus;
        this.broker = broker;
        this.pollInt = pollInt;
        this.connections = {};
        this.devices = {};
    }

    /**
     * Start function instantiates all connections defined in the config file
     */
    async start() {
        try {
            // Fetch our config
            const ids = await this.fetchIdentities();
            const conf = await this.fetchConfig(ids.uuid!);
            const spConf = {
                ...conf.sparkplug!, address: ids.sparkplug!, uuid: ids.uuid!,
            };

            // Create sparkplug node
            this.sparkplugNode = await new SparkplugNode(this.fplus, spConf).init();
            log(`Created Sparkplug node "${ids.sparkplug!}".`);

            log("Starting driver broker...");
            //this.broker.on("message", msg => 
            //    log(util.format("Driver message: %O", msg)));
            await this.broker.start();

            // Create a new device connection for each type listed in config file
            log('Building up connections and devices...');
            conf?.deviceConnections?.forEach(c => this.setupConnection(c));

            // Setup Sparkplug node handlers
            this.setupSparkplug();

        } catch (e: any) {
            log(`Error starting translator: ${e.message}`);
            console.error((e as Error).stack);

            // If the config is giving us errors we'll stop here
            log(`Error starting translator.`);
            await this.stop();
        }
    }

    /**
     * Stop function stops all devices, connections, and clients in preparation for destruction
     */
    async stop(kill: Boolean = false) {
        log('Waiting for devices to stop...');
        await Promise.all(Object.values(this.devices)?.map((dev: Device) => {
            log(`Stopping device ${dev._name}`);
            dev.stop();
        }));
        log('Waiting for connections to close...');
        await Promise.all(Object.values(this.connections)?.map((connection) => {
            log(`Closing connection ${connection._type}`);
            connection.close();
        }));
        log("Stopping driver broker...");
        await this.broker.stop();
        log('Waiting for sparkplug node to stop...');
        await this.sparkplugNode?.stop();

        log('Stop complete.');

        this.emit('stopped', kill);
    }

    setupSparkplug() {
        const sp = this.sparkplugNode;

        /**
         * What to do when a Sparkplug Birth certificate is requested
         * @param deviceId The Device ID which must produce a birth certificate
         */
        sp.on('dbirth', (deviceId) => {
            log('Handling DBIRTH request for ' + deviceId);
            Object.values(this.devices).find((e: Device) => e._name === deviceId)?._publishDBirth();
        });

        /**
         * What to do when a Sparkplug Birth certificate is requested
         * @param deviceId The Device ID which must produce a birth certificate
         */
        sp.on('dbirth-all', () => {
            log('Publishing DBIRTH request for all devices');
            Object.values(this.devices)?.map((dev: Device) => {
                dev._publishDBirth();
            })
        });

        /**
         * What to do when a Sparkplug Device Command is received
         * @param deviceId The Device ID which must produce a birth certificate
         * @param payload The Sparkplug payload containing DCMD metrics
         */
        sp.on('dcmd', (deviceId, payload) => {
            log('Handling DCMD request for ' + deviceId);
            Object.values(this.devices).find((e: Device) => e._name === deviceId)?._handleDCmd(payload);
        });

        // Listen to the stop event
        sp.on('stop', () => {
            log('Handling stop request for all devices');
            this.stop();
        })
    }

    setupConnection(connection: any): void {
        const cType = connection.connType;
        const deviceInfo = this.chooseDeviceInfo(cType);

        if (deviceInfo == undefined) {
            log(`Failed to find DeviceInfo for connection type '${cType}'`);
            return;
        }

        // Instantiate device connection
        const newConn = this.connections[cType] = new deviceInfo.connection(
            connection.connType,
            connection[deviceInfo.connectionDetails],
            /* XXX These additional parameters are a hack for now to
             * make the DriverConnection work. They want refactoring
             * later. */
            connection.name,
            this.broker);

        connection.devices?.forEach((devConf: deviceOptions) => {
            this.devices[devConf.deviceId] = new Device(
                this.sparkplugNode, newConn, devConf);
        });

        // What to do when the connection is open
        newConn.on('open', () => {
            connection.devices?.forEach((devConf: deviceOptions) => {
                this.devices[devConf.deviceId]?._deviceConnected();
            })
        });

        // What to do when the device connection has new data from a device
        newConn.on('data', (obj: { [index: string]: any }, parseVals = true) => {
            //log(util.format("Received data for %s: (%s) %O",
            //    connection.name, parseVals, obj));
            connection.devices?.forEach((devConf: deviceOptions) => {
                this.devices[devConf.deviceId]?._handleData(obj, parseVals);
            })
        })

        // What to do when device connection dies
        newConn.on('close', () => {
            connection.devices?.forEach((devConf: deviceOptions) => {
                this.devices[devConf.deviceId]?._deviceDisconnected();
            })
        });

        // Open the connection
        newConn.open();
    }

    /* There is a better way to do this. At minimum this should be in a
     * factory class, not the main Translator class. */
    chooseDeviceInfo(connType: string): deviceInfo | undefined {
        // Initialise the connection parameters
        switch (connType) {
            case "REST":
                return {
                    connection: RestConnection, connectionDetails: 'RESTConnDetails'
                }
            case "MTConnect":
                return {
                    connection: MTConnectConnection, connectionDetails: 'MTConnectConnDetails'
                }
            case "EtherNet/IP":
                return {
                    connection: EtherNetIPConnection, connectionDetails: 'EtherNetIPConnDetails'
                }
            case "S7":
                return {
                    connection: S7Connection, connectionDetails: 's7ConnDetails'
                }
            case "OPC UA":
                return {
                    connection: OPCUAConnection, connectionDetails: 'OPCUAConnDetails'
                }
            case "MQTT":
                return {
                    connection: MQTTConnection, connectionDetails: 'MQTTConnDetails'
                }
            case "Websocket":
                return {
                    connection: WebsocketConnection, connectionDetails: 'WebsocketConnDetails'
                }
            case "UDP":
                return {
                    connection: UDPConnection, connectionDetails: 'UDPConnDetails'

                }
            case "Driver":
                return {
                    connection: DriverConnection,
                    connectionDetails: "DriverDetails",
                };
            default:
                return;
        }
    }

    /* Fetch our identities (UUID, Sparkplug) from the Auth service. */
    async fetchIdentities(): Promise<Identity> {
        const auth = this.fplus.Auth;

        const ids = await this.retry("identities", async () => {
            const ids = await auth.find_principal();
            if (!ids || !ids.uuid || !ids.sparkplug) throw "Auth service not responding correctly";
            return ids;
        });

        log(`Found my identities: UUID ${ids.uuid}, Sparkplug ${ids.sparkplug}`);
        return ids;
    }

    /* Fetch our config from the ConfigDB. */
    async fetchConfig(uuid: string): Promise<translatorConf> {
        const cdb = this.fplus.ConfigDB;

        /* XXX This is a mess. We want an Error monad, I think, or
         * recast everything with try/catch/custom exceptions */

        let [config, etag] = await this.retry("config", () => cdb.get_config_with_etag(UUIDs.App.AgentConfig, uuid));

        log(`Fetched config with etag [${etag}]`);

        let valid = true;
        if (config) {
            // Replace all occurrences of __FPSI_<v4UUID> with the actual
            // secret of the same name from /etc/secrets

            // First, convert it to a string
            const configString = JSON.stringify(config);

            // Then, replace all occurrences of __FPSI_<v4UUID> with the
            // actual secret of the same name from the secret path

            // If the SECRETS_PATH is set in the environment, use that as the secret path, otherwise use the default
            const secretBasePath = process.env.SECRETS_PATH || '/etc/secrets';

            const secretReplacedConfig = configString.replace(/__FPSI__[a-f0-9-]{36}/g, (match) => {
                try {
                    // Attempt to get the secret contents from the file in /etc/secrets with the same name
                    const secretPath = `${secretBasePath}/${match}`;
                    const val = fs.readFileSync(secretPath, 'utf8');
                    return val;
                } catch (err: any) {
                    // Handle error (e.g., file not found) gracefully
                    console.error(`Error reading secret from ${match}: ${err.message}`);
                    valid = false;
                    return "SECRET_NOT_FOUND";
                }
            });

            // Then, convert it back to an object and validate
            if (valid) {
                try {
                    config = JSON.parse(secretReplacedConfig);
                    //valid = validateConfig(config);
                } catch {
                    valid = false;
                }
            }
        }

        const conns = config && valid ? reHashConf(config).deviceConnections : [];

        if (!valid) log("Config is invalid or nonexistent, ignoring");

        return {
            sparkplug: {
                nodeControl: config?.sparkplug,
                configRevision: etag,
                alerts: {
                    configFetchFailed: !config,
                    configInvalid: !valid,
                },
            },
            deviceConnections: conns,
        };
    }

    async retry<RV>(what: string, fetch: () => Promise<RV>): Promise<RV> {
        const interval = this.pollInt;

        while (true) {
            log(`Attempting to fetch ${what}...`);
            try {
                const rv = await fetch();
                log(`Fetched ${what}.`);
                return rv;
            } catch (e) {
                log(`Failed to fetch ${what}: ${e}.\n
Trying again in ${interval} seconds...`);
            }
            await timers.setTimeout(interval * 1000);
        }
    }
}
