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
        try {
             if (!this.scoutDetails?.isEnabled) {
                log(`Scouting is not enabled, so you cannot perform scouting for ${this.deviceConnection._type}`);
                this.emit("scoutResults", {success: false});
                return;
            }

            log(`Starting scouting for ${this.deviceConnection._type}`);
            const addresses: object = await this.deviceConnection.scoutAddresses(this.driverDetails);

            console.log(`Stopped scouting for ${this.deviceConnection._type}`);
            this.emit("scoutResults", {
                addresses: addresses,
                timestamp: Date.now(),
                success: true
            });
        }
        catch (err) {
            log(`Error during scouting: ${(err as Error).message}`);
            this.emit("scoutResults", {success: false});
        }
    }

    private validateScoutConfig(scoutDetails: any): ScoutDetails {
        if (!scoutDetails) {
            throw new Error("Error: scoutDetails does not exist.");
        }
        else if(typeof scoutDetails.isEnabled !== 'boolean'){
            throw new Error("Error: scoutDetails.isEnabled must be boolean.");
        }

        return {isEnabled: scoutDetails.isEnabled};
    }
}
    

