import { EventEmitter } from "events";
import { DeviceConnection } from "./device.js";
import { log } from "./helpers/log.js";
import { NodeIdType } from "node-opcua";

export interface scoutDetails { }

export interface mqttScoutDetails extends scoutDetails {
    duration: number;
    topic: string;
}

export class opcuaScoutDetails implements scoutDetails {
    NodeIdType: NodeIdType = NodeIdType.NUMERIC;
    Identifier: number | string = 0;
    NamespaceIndex: number = 0;
}

export class Scout extends EventEmitter {
    private deviceConnection: DeviceConnection;
    private scoutDetails: scoutDetails;

    constructor(deviceConnection: DeviceConnection, scoutConfig: any) {
        super();
        this.deviceConnection = deviceConnection;
        this.scoutDetails = this.extractScoutConfig(scoutConfig);
    }

    private extractScoutConfig(config: any): scoutDetails {
        if (this.deviceConnection._type === "MQTT") {
            return {
                duration: config.scout?.duration ?? 10000,
                topic: config.scout?.topic ?? "#",
            } as mqttScoutDetails;
        } else if (this.deviceConnection._type === "OPC UA") {
            const nodeIdTypeConf = config.scout?.NodeIdType?.toUpperCase() ?? "NUMERIC";
            let opcuaScoutConfig: opcuaScoutDetails = {
                NodeIdType: NodeIdType.NUMERIC,
                Identifier: 0,
                NamespaceIndex: 0,
            };

            switch (nodeIdTypeConf) {
                case "NUMERIC":
                    opcuaScoutConfig = {
                        NodeIdType: NodeIdType.NUMERIC,
                        Identifier: Number(config.scout?.Identifier) || 0,
                        NamespaceIndex: Number(config.scout?.NamespaceIndex) || 0,
                    };
                    break;
                case "STRING":
                    opcuaScoutConfig = {
                        NodeIdType: NodeIdType.STRING,
                        Identifier: String(config.scout?.Identifier) || "RootFolder",
                        NamespaceIndex: Number(config.scout?.NamespaceIndex) || 0,
                    };
                    break;
                case "GUID":
                    opcuaScoutConfig = {
                        NodeIdType: NodeIdType.GUID,
                        Identifier: String(config.scout?.Identifier) || "",
                        NamespaceIndex: Number(config.scout?.NamespaceIndex) || 0,
                    };
                    break;
                case "BYTESTRING":
                    opcuaScoutConfig = {
                        NodeIdType: NodeIdType.BYTESTRING,
                        Identifier: String(config.scout?.Identifier) || "",
                        NamespaceIndex: Number(config.scout?.NamespaceIndex) || 0,
                    };
                    break;
                default:
                    opcuaScoutConfig = {
                        NodeIdType: NodeIdType.NUMERIC,
                        Identifier: 85,
                        NamespaceIndex: 0,
                    };
                    break;
            }
            return opcuaScoutConfig;
        } else {
            throw new Error("Scouting not supported for this device connection type.");
        }
    }

    public async performScouting() {
        if (typeof this.deviceConnection.scoutAddresses !== "function") {
            throw new Error("The provided DeviceConnection does not support scouting.");
        }
        log(`Starting scouting for ${this.deviceConnection._type}`);
        const addresses = await this.deviceConnection.scoutAddresses(this.scoutDetails);
        console.log(`Stopped scouting for ${this.deviceConnection._type}`);

        this.emit("scoutComplete", addresses);
    }
}
