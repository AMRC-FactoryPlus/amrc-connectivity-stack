/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { Device, DeviceConnection, deviceOptions } from "../device.js";
import { log } from "../helpers/log.js";
import { SparkplugNode } from "../sparkplugNode.js";
import {
    Metrics,
    restAuthMethod,
    restConnDetails,
    serialisationType,
    writeValuesToPayload
} from "../helpers/typeHandler.js";
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import * as crypto from "crypto";


export class RestConnection extends (
    DeviceConnection
) {
    #baseURL: string
    #axiosOptions: AxiosRequestConfig

    constructor(type: string, connDetails: restConnDetails) {
        super(type);
        this.#baseURL = connDetails.baseURL;
        this.#axiosOptions = {
            headers: {
                Accept: "*/*"
            },
        };

        if (connDetails.authMethod === restAuthMethod.Basic) {
            if (connDetails.username == null || connDetails.password == null) {
                throw new Error("REST Auth Method 'Basic' Set but no Username or Password Provided");
            }
            const token = Buffer.from(
                `${connDetails.username}:${connDetails.password}`
            ).toString("base64");
            this.#axiosOptions.headers.Authorization = "Basic " + token;
        }
    }

    open() {
        log(`${this._type} connection ready`);
        this.emit('open');
    }

    /**
     * Read new values for provided  metrics from device connection
     * Should return old  metric values for RbE checking
     * @param {sparkplugMetric[]}  metrics Array of  metric objects to read new values of
     */
    async readMetrics(metrics: Metrics, payloadFormat?: string, delimiter?: string) {
        if (payloadFormat && payloadFormat !== "Defined by Protocol") {
            await Promise.all(metrics.addresses.filter(e => e !== 'undefined').map(async (addr) => {
                let res: AxiosResponse = { data: [], status: -1, statusText: "", headers: "", config: {} };
                let subAddr = addr.match(/\${(\d):(\w)}/);
                if (subAddr && subAddr.length > 1) {
                    let foundLastSubAddr = false;
                    let counter = parseInt(subAddr[1]);
                    const stop = typeof subAddr[2] !== "undefined" ? parseInt(subAddr[2]) : Infinity;
                    do {
                        const subRes = await this.get(addr.replace(/\${.+}/g, counter.toString()));
                        if (subRes.status == 200) {
                            res = { ...subRes, data: [res.data, ...subRes.data] }
                            counter++;
                        } else {
                            foundLastSubAddr = true;
                        }
                    } while (!foundLastSubAddr || counter < stop)
                } else {
                    res = await this.get(addr);
                }

                if (res && res.status == 200) {
                    let payload: any;
                    if (payloadFormat == serialisationType.fixedBuffer) {
                        payload = Buffer.from(res.data);
                    } else {
                        payload = res.data;
                    }
                    let obj: any = {};
                    obj[addr] = payload;
                    this.emit('data', obj);
                }
            }));
        } else {
            log("A payload format is required for a REST connection.")
        }
    }

    /**
     * Write new values for provided  metrics to the device connection
     * @param {sparkplugMetric[]}  metrics Array of  metric objects to write new values of
     */
    async writeMetrics(metrics: Metrics, writeCallback: Function, payloadFormat: string) {
        await Promise.all(metrics.addresses.map(async (addr) => {
            let body = writeValuesToPayload(metrics.getByAddress(addr), payloadFormat);
            const res = await this.post(addr, body, payloadFormat);
        }))
        writeCallback();
    }

    /**
     * Make a HTTP GET request to the given address. This method
     * functionally replaces the "readMetric" method for a REST endpoint.
     * @param {String} address The URL to GET
     * @param optionsOverride
     */
    async get(address: string, optionsOverride?: AxiosRequestConfig): Promise<AxiosResponse | any> {
        // Try to get a response
        return axios.get(this.#baseURL + address, optionsOverride || this.#axiosOptions)
            .catch((err: AxiosError) => {
                if (axios.isAxiosError(err)) {
                    if (err.response) {
                        // The request was made and the server responded with a status code
                        // that falls out of the range of 2xx
                        log(err.response.data);
                        log(JSON.stringify(err.response.status));
                        log(err.response.headers);
                        log("Address: " + this.#baseURL + address);
                    } else {
                        // Something happened in setting up the request that triggered an Error
                        log(err.message);
                    }
                } else {
                    log(err as string);
                }
            });
    }

    async post(address: string, data: any, payloadFormat: string) {
        // Try to get a response
        let options = { ...this.#axiosOptions };
        if (payloadFormat == serialisationType.JSON || payloadFormat == serialisationType.JSONBatched) {
            options.headers["Content-Type"] = "application/json";
        } else if (payloadFormat == serialisationType.XML) {
            options.headers["Content-Type"] = "application/xml";
        } else if (payloadFormat == serialisationType.fixedBuffer) {
            options.headers["Content-Type"] = "application/octet-stream";
        } else if (payloadFormat == serialisationType.delimited) {
            options.headers["Content-Type"] = "text/plain; charset=UTF-8";
        }
        try {
            console.log(`POSTing ${data} to ${this.#baseURL + address}`);
            return await axios.post(this.#baseURL + address, data, options);
        } catch (e: any) {
            console.log("post error");
            return e.response;
        }
    }

    async put() {
    }

    async delete() {
    }
};
