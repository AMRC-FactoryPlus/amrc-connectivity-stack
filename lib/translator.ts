/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

// Import device connections
import {
    SparkplugNode
} from "./sparkplugNode.js";

// Import devices
import {
    RestConnection,
    RestDevice
} from "./devices/REST.js";
import {
    S7Connection,
    S7Device
} from "./devices/S7.js";
import {
    OPCUAConnection,
    OPCUADevice
} from "./devices/OPCUA.js";
import {
    MQTTConnection,
    MQTTDevice
} from "./devices/MQTT.js";
import {
    UDPConnection,
    UDPDevice
} from "./devices/UDP.js";
import {
    WebsocketConnection,
    WebsocketDevice
} from "./devices/websocket.js";
import {
    MTConnectConnection,
    MTConnectDevice
} from "./devices/MTConnect.js";
import {
    log
} from "./helpers/log.js";
import {
    sparkplugConfig
} from "./helpers/typeHandler.js";
import {
    Device,
    deviceOptions
} from "./device.js";
import {EventEmitter} from "events";

/**
 * Translator class basically turns config file into instantiated classes
 * for device protocol translation and Sparkplug communication
 */

export interface translatorConf {
    sparkplug: sparkplugConfig,
    deviceConnections: any[]
}

export class Translator extends EventEmitter {
    /**
     * Class constructor - Unpacks config file and defines helpful class attributes
     * @param {Object} conf Config file from web UI
     */
    sparkplugNode!: SparkplugNode
    conf: translatorConf
    connections: {
        [index: string]: any
    }
    supportedChannels: {
        [index: string]: string
    }
    devices: {
        [index: string]: any
    }

    constructor(conf: translatorConf) {
        super();

        this.conf = conf;
        this.connections = {};
        this.devices = {};
        this.supportedChannels = {
            DMX: "Gateway DMX",
            CANOpen: "Gateway CANOpen",
            DeviceNet: "Gateway DeviceNet",
            EtherCAT: "Gateway EtherCAT",
            "Ethernet/IP": "Gateway Ethernet/IP",
            "ModbusRTU Gateway": "Gateway ModbusRTU",
            "ModbusTCP Gateway": "Gateway ModbusTCP",
            "Virtual Device 32 Byte": "Virtual Device 32 Byte",
            "Virtual Device 32 Byte (Ext.)": "Virtual Device 32 Byte (Ext.)",
            "Virtual ModbusTCP Slave": "ModbusTCP Slave",
            "Virtual ModbusTCP Slave (512)": "ModbusTCP Slave (512)",
            "Virtual ModbusRTU Slave": "ModbusRTU Slave",
            "Virtual ModbusRTU Slave (512)": "ModbusRTU Slave (512)",
            "Virtual ModbusTCP Master": "ModbusTCP Master",
            "Virtual ModbusRTU Master": "ModbusRTU Master",
            "Virtual ModbusRTU Master 150": "ModbusRTU Master 150",
            "Virtual ModbusTCP Master 150": "ModbusTCP Master 150",
            "Virtual RevPi7": "RevPi7",
            "Virtual RevPiTimer": "RevPiTimer",
            Powerlink: "Gateway Powerlink",
            Profibus: "Gateway Profibus",
            Profinet: "Gateway Profinet IRT",
            SercosIII: "Gateway SercosIII",
            Serial: "Gateway Serial",
            "CANopen Master": "Gateway CANopen Master",
            Can: "Connect Can",
            "M-Bus": "Connect M-Bus",
            DIO: "RevPi DIO",
            DI: "RevPi DI",
            DO: "RevPi DO",
            AIO: "RevPi AIO",
        };
    }

    /**
     * Start function instantiates all connections defined in the config file
     */
    async start() {
        try {
            // Create sparkplug node

            this.sparkplugNode = new SparkplugNode(this.conf.sparkplug);

            log(`Created Sparkplug node "${this.conf.sparkplug.edgeNode}" in group "${this.conf.sparkplug.groupId}".`);

            log('Building up connections and devices...');

            if (typeof this.sparkplugNode) {

                // Create a new device connection for each type listed in config file
                this.conf.deviceConnections?.forEach(connection => {

                    type deviceInfo = {
                        type: any,
                        connection: any;
                        connectionDetails: any
                    };

                    let deviceInfo: deviceInfo = {
                        connectionDetails: undefined,
                        connection: undefined,
                        type: undefined
                    };

                    // Initialise the connection parameters
                    switch (connection.connType) {
                        case "REST":
                            deviceInfo = {
                                type: RestDevice,
                                connection: RestConnection,
                                connectionDetails: 'RESTConnDetails'
                            }
                            break;
                        case "MTConnect":
                            deviceInfo = {
                                type: MTConnectDevice,
                                connection: MTConnectConnection,
                                connectionDetails: 'MTConnectConnDetails'
                            }
                            break;
                        case "S7":
                            deviceInfo = {
                                type: S7Device,
                                connection: S7Connection,
                                connectionDetails: 's7ConnDetails'
                            }
                            break;
                        case "OPC UA":
                            deviceInfo = {
                                type: OPCUADevice,
                                connection: OPCUAConnection,
                                connectionDetails: 'OPCUAConnDetails'
                            }
                            break;
                        case "MQTT":
                            deviceInfo = {
                                type: MQTTDevice,
                                connection: MQTTConnection,
                                connectionDetails: 'MQTTConnDetails'
                            }
                            break;
                        case "Websocket":
                            deviceInfo = {
                                type: WebsocketDevice,
                                connection: WebsocketConnection,
                                connectionDetails: 'WebsocketConnDetails'
                            }
                            break;
                        case "UDP":
                            deviceInfo = {
                                type: UDPDevice,
                                connection: UDPConnection,
                                connectionDetails: 'UDPConnDetails'

                            }
                            break;
                        default:
                            break;
                    }

                    // Instantiate device connection
                    this.connections[connection.connType] = new deviceInfo.connection(
                        connection.connType,
                        connection[deviceInfo.connectionDetails]
                    );

                    connection.devices?.forEach((devConf: deviceOptions) => {
                        this.devices[devConf.deviceId] = new deviceInfo.type(
                            this.sparkplugNode,
                            this.connections[connection.connType],
                            devConf
                        );
                    });

                    // What to do when the connection is open
                    this.connections[connection.connType].on('open', () => {
                        connection.devices?.forEach((devConf: deviceOptions) => {
                            this.devices[devConf.deviceId]?._deviceConnected();
                        })
                    });

                    // What to do when the device connection has new data from a device
                    this.connections[connection.connType].on('data', (obj: { [index: string]: any }, parseVals = true) => {
                        connection.devices?.forEach((devConf: deviceOptions) => {
                            this.devices[devConf.deviceId]?._handleData(obj, parseVals);
                        })
                    })

                    // What to do when device connection dies
                    this.connections[connection.connType].on('close', () => {
                        connection.devices?.forEach((devConf: deviceOptions) => {
                            this.devices[devConf.deviceId]?._deviceDisconnected();
                        })
                    });

                    // Open the connection
                    this.connections[connection.connType].open();

                });

                /**
                 * What to do when a Sparkplug Birth certificate is requested
                 * @param deviceId The Device ID which must produce a birth certificate
                 */
                this.sparkplugNode.on('dbirth', (deviceId) => {
                    log('Handling DBIRTH request for ' + deviceId);
                    Object.values(this.devices).find((e: Device) => e._name === deviceId)?._publishDBirth();
                });

                /**
                 * What to do when a Sparkplug Birth certificate is requested
                 * @param deviceId The Device ID which must produce a birth certificate
                 */
                this.sparkplugNode.on('dbirth-all', () => {
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
                this.sparkplugNode.on('dcmd', (deviceId, payload) => {
                    log('Handling DCMD request for ' + deviceId);
                    Object.values(this.devices).find((e: Device) => e._name === deviceId)?._handleDCmd(payload);
                });

                // Listen to the stop event
                this.sparkplugNode.on('stop', () => {
                    log('Handling stop request for all devices');
                    this.stop();
                })
            }

        } catch (e: any) {
            log(e.stack);
            // If the config is giving us errors we'll stop here
            log(`Error starting translator.`);
            await stop();
        }


    }

    /**
     * Stop function stops all devices, connections, and clients in preparation for destruction
     */
    async stop(kill: Boolean = false) {
        log('Waiting for devices to stop...');
        await Promise.all(
            Object.values(this.devices)?.map((dev: Device) => {
                log(`Stopping device ${dev._name}`);
                dev.stop();
            })
        );
        log('Waiting for connections to close...');
        await Promise.all(
            Object.values(this.connections)?.map((connection) => {
                log(`Closing connection ${connection._type}`);
                connection.close();
            })
        );
        log('Waiting for sparkplug node to stop...');
        await this.sparkplugNode?.stop();

        log('Stop complete.');

        this.emit('stopped', kill);
    }
}