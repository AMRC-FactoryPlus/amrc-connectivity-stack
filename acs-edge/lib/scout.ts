import { EventEmitter } from "events";
import { DeviceConnection } from "./device.js";
import { log } from "./helpers/log.js";

export interface ScoutDetails {
    isEnabled: boolean
}

export interface ScoutDriverDetails {

}

export interface ScoutResult {
    addresses: object | null,
    timestamp: number | null,
    success: boolean,
}

export class Scout extends EventEmitter {
    private deviceConnection: DeviceConnection;
    private scoutDetails: ScoutDetails | null;
    private driverDetails: any | null;


    constructor(deviceConnection: DeviceConnection, scoutFullConfig: any) {
        super();
        this.deviceConnection = deviceConnection;
        this.scoutDetails = this.validateScoutConfig(scoutFullConfig.scoutDetails);
        this.driverDetails = scoutFullConfig.driverDetails;
    }


    public async performScouting(): Promise<void> {
        let scoutResult: ScoutResult = { addresses: null, success: true, timestamp: null };
        try {
            if (this.scoutDetails?.isEnabled === false) {
                log(`Scouting isEnabled is False, so you cannot perform scouting for ${this.deviceConnection._type}`);
                scoutResult.success = false;
            }
            else if (typeof this.deviceConnection.scoutAddresses !== "function") {
                throw new Error("The provided DeviceConnection does not support scouting.");
            }
            else {
                log(`Starting scouting for ${this.deviceConnection._type}`);
                const addresses: object = await this.deviceConnection.scoutAddresses(this.driverDetails);

                scoutResult = {
                    addresses: addresses,
                    timestamp: Date.now(),
                    success: true
                };

                console.log(`Stopped scouting for ${this.deviceConnection._type}`);
            }
        }
        catch (err) {
            log(`Error during scouting: ${(err as Error).message}`);
            scoutResult.success = false;
        }
        finally {
            this.emit("scoutResults", scoutResult);
        }
    }

    private validateScoutConfig(scoutDetails: any): ScoutDetails {
        if (!scoutDetails) {
            log('scoutDetails passed from Edge Agent is null or undefined.')
            return { isEnabled: false };
        } else {
            return {
                isEnabled: typeof scoutDetails.isEnabled === 'boolean' ? scoutDetails.isEnabled : false
            }
        }
    }
}
