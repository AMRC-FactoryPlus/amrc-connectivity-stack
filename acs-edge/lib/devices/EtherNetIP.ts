/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {Device, DeviceConnection, deviceOptions} from "../device.js";
import {log} from "../helpers/log.js";
import {SparkplugNode} from "../sparkplugNode.js";
import {Metrics, serialisationType} from "../helpers/typeHandler.js";
import {Controller} from 'st-ethernet-ip'

/**
 * Define structure of options for device connection
 */
export default interface etherNetIPConnDetails {
    host: string
}

/**
 * Define class for your device connection type
 */
export class EtherNetIPConnection extends DeviceConnection {
    #client: Controller
    #connDetails: etherNetIPConnDetails

    constructor(type: string, connDetails: etherNetIPConnDetails) {
        super(type);

        this.#client = new Controller();
        this.#connDetails = connDetails;
    }

    open() {

        // Try to connect to the EtherNet/IP device with an exponential backoff if the connection fails
        const maxDelay = 600000; // Maximum delay of 10 minutes in milliseconds
        let delay = 1000; // Start with a 1 second delay

        const attemptConnect = () => {
            log(`Attempting to connect to southbound EtherNet/IP device...`);
            this.#client.connect(this.#connDetails.host, Buffer.from([]), false).then(() => {
                log(`🔌 Southbound EtherNet/IP device connected (${this.#connDetails.host}).`);

                this.emit('open');
            }).catch((err) => {
                log(`⚠️  Could not connect to southbound EtherNet/IP device. Trying again in ${delay / 1000} seconds...`);
                // Log the error using console.log to ensure that objects are logged correctly
                console.log(err);

                // Schedule the next attempt, capping the delay at maxDelay
                setTimeout(attemptConnect, delay);
                delay = Math.min(delay * 2, maxDelay); // Double the delay for the next attempt, but do not exceed maxDelay
            });
        };

        // Initially try to connect without any delay
        attemptConnect();
    }

    /**
     *
     * @param metrics Metrics object
     * @param writeCallback Function to call when write attempt complete
     * @param payloadFormat Optional string denoting the payload format, must be one of serialisationType
     * @param delimiter Optional string specifying the delimiter character if needed
     */
    writeMetrics(metrics: Metrics, writeCallback: Function, payloadFormat?: serialisationType, delimiter?: string) {
        console.log('Writing metrics to EtherNet/IP devices is not yet supported.');
    }

    /**
     *
     * @param metrics Metrics object
     * @param payloadFormat Optional string denoting the payload format, must be one of serialisationType
     * @param delimiter Optional string specifying the delimiter character if needed
     */
    async readMetrics(metrics: Metrics, payloadFormat?: string, delimiter?: string) {

        // Double check that the payload format is correct for EtherNet/IP. We only currently support the Buffer
        // payload format.
        if (payloadFormat !== "Buffer") {
            log("Buffer payload format is required for an EtherNet/IP connection.")
            return;
        }

        // Read each metric (that has an address) from the device and for each unique address, go and get the data.
        metrics.addresses.filter(e => e && e !== 'undefined').forEach((addr) => {

            // The metric address selector for EtherNet/IP is in the format "classId,instance,attribute"
            // (e.g. "3,108,4")
            const splitAddress = addr.split(',');
            const classId = parseInt(splitAddress[0]);
            const instance = parseInt(splitAddress[1]);
            const attribute = parseInt(splitAddress[2]);

            this.#client.getAttributeSingle(classId, instance, attribute).then((val: Buffer) => {

                let obj: any = {};
                obj[addr] = val;

                this.emit('data', obj);

            }).catch((err: any) => {
                log('Error reading metric:');
                console.log(err);
            });

        })
    }

    /**
     * Close connection and tidy up
     */
    async close() {
        // Do whatever cleanup code you need to here
        await this.#client.disconnect();
    }
}
