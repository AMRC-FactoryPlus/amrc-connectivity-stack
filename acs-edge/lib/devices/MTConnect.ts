/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {deviceOptions} from "../device";
import {SparkplugNode} from "../sparkplugNode";
import {PassThrough} from 'stream';
import {log} from '../helpers/log.js';

import {Metrics, restConnDetails, serialisationType} from "../helpers/typeHandler.js";
import {RestConnection} from "./REST.js";
import axios, {CancelTokenSource, CancelTokenStatic} from "axios";

export class MTConnectConnection extends (
    RestConnection
) {
    #connDetails: restConnDetails
    #cancelToken: CancelTokenStatic;
    #source: CancelTokenSource

    constructor(type: string, connDetails: restConnDetails) {
        super(type, connDetails);
        this.#connDetails = connDetails;
        this.#cancelToken = axios.CancelToken;
        this.#source = this.#cancelToken.source();
    }

    async startSubscription(
        metrics: Metrics,
        payloadFormat: string,
        delimiter: string,
        interval: number,
        deviceId: string,
        subscriptionStartCallback: Function) {
        this.sample(metrics, interval);
        subscriptionStartCallback();
    }

    /**
     * Opens http connection stream and emits data response
     * @param pollInt Connection Polling interval
     */
    async sample(metrics: Metrics, interval: number) {
        let res = await this.get(
            `/sample?interval=0&heartbeat=1000`,
            {
                responseType: "stream",
                cancelToken: this.#source.token
            }
        );
        let headersCompleted = false;
        let bodyCompleted = false;
        let buffer = Buffer.alloc(0);
        let receivedBodyChunk = 0;
        let contentLength = 0;
        const pass = new PassThrough();
        pass.on('data', (chunk) => {
            if (!headersCompleted) {
                const headers = chunk.toString().split(/\r?\n/);
                if (headers.length >= 3) {
                    try {
                        contentLength = parseInt(headers[2].split(":")[1]);
                        if (!isNaN(contentLength)) {
                            buffer = Buffer.alloc(contentLength);
                            headersCompleted = true;
                        }
                    } catch (e) {
                        console.log(e);
                    }
                }
            }
            if (receivedBodyChunk < contentLength || isNaN(contentLength)) {
                const contentStartOffset = Math.max(chunk.indexOf("<?xml", 0, 'utf8'), 0);
                try {
                    chunk.copy(buffer, receivedBodyChunk, contentStartOffset, chunk.byteLength);
                } catch (err) {
                    console.log(err);
                }
                receivedBodyChunk += chunk.byteLength - contentStartOffset;

                if (receivedBodyChunk === contentLength) {
                    bodyCompleted = true;
                }
            }
            if (bodyCompleted) {
                // this.emit("asyncData", buffer);
                let payload = Buffer.from(buffer);
                metrics.addresses.forEach(addr => {
                    let obj: any = {};
                    obj[addr] = payload;
                    this.emit('data', obj);
                })
                headersCompleted = false;
                bodyCompleted = false;
                buffer = Buffer.alloc(0);
                receivedBodyChunk = 0;
            }
        });
        res.data.pipe(pass);
    }

    open() {
        log(`${this._type} connection ready`);
        this.emit('open');
    }

    close(): void {
        log("Closing MTConnectConnection");
        this.#source.cancel("Stream Close Requested");
        this.emit("close");
    }
};
