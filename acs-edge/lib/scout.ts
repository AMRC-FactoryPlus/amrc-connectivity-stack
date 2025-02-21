
// this class will be updated in the future to handle a more detailed configuration for scouting mode. E.g., if the device connection protocol is MQTT then for how long the Scouting mode should listen for topics, what topic to listen to, etc.

import { EventEmitter } from "events";
import { DeviceConnection } from "./device.js";
import { log } from "./helpers/log.js";

export interface scoutDetails {

}

export interface mqttScoutDetails extends scoutDetails {
    duration: number
    topic: string
}

export class opcuaScoutDetails implements scoutDetails {
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
        if (this.deviceConnection._type === 'MQTT') {
            const mqttScoutConfig: mqttScoutDetails = {
                duration: config.scout?.duration ?? 10000,
                topic: config.scout?.topic ?? '#',
            };
            return mqttScoutConfig;
        }
        else if (this.deviceConnection._type === 'OPC UA') {
            const opcuaScoutConfig: opcuaScoutDetails = {

            }
            return opcuaScoutConfig;
        }
        else {
            // todo: add other types of scoutDetails: opcua, etc.,
            throw new Error('Scouting not supported for this device connection type.');
        }
    }

    public async performScouting() {
        if (typeof this.deviceConnection.scoutAddresses !== 'function') {
            throw new Error('The provided DeviceConnection does not support scouting.');
        }
        log(`Starting scouting for ${this.deviceConnection._type}`)
        const addresses = await this.deviceConnection.scoutAddresses(this.scoutDetails);
        console.log(`Stopped scouting for ${this.deviceConnection._type}`);

        this.emit('scoutComplete', addresses);
    }
}