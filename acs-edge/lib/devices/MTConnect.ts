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
    #nextSequence: number | null = null;
    #pollInterval: NodeJS.Timeout | null = null;

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
     * Polls MTConnect endpoints at regular intervals
     * @param metrics Metrics object containing endpoint addresses
     * @param interval Polling interval in milliseconds
     */
    async sample(metrics: Metrics, interval: number) {
        // Get all unique addresses
        const endpoints = [...new Set(metrics.addresses)];
        
        log(`[MTConnect] Starting polling of ${endpoints.length} endpoint(s) every ${interval}ms`);
        
        // Function to fetch data from a specific endpoint
        const pollEndpoint = async (endpoint: string) => {
            try {
                // Build URL with sequence parameter if available
                let url = endpoint;
                
                // Add sequence parameter for /sample endpoints
                if (endpoint.includes('/sample') && this.#nextSequence) {
                    url = endpoint.includes('?')
                        ? `${endpoint}&from=${this.#nextSequence}`
                        : `${endpoint}?from=${this.#nextSequence}`;
                }
                
                log(`[MTConnect] Polling: ${url}`);
                
                let res = await this.get(url, {
                    cancelToken: this.#source.token
                });

                // Convert response to string
                const xmlData = typeof res.data === 'string' 
                    ? res.data 
                    : res.data.toString();

                // Extract and update nextSequence for future requests
                const nextSeqMatch = xmlData.match(/nextSequence="(\d+)"/);
                if (nextSeqMatch) {
                    this.#nextSequence = parseInt(nextSeqMatch[1]);
                    log(`[MTConnect] Updated sequence to: ${this.#nextSequence}`);
                }

                // Emit data only for this specific endpoint
                let obj: any = {};
                obj[endpoint] = Buffer.from(xmlData);
                this.emit('data', obj);

            } catch (err: any) {
                // Log detailed error information including the problematic address
                if (err.response) {
                    // HTTP error (4xx, 5xx)
                    log(`[MTConnect] ERROR - Invalid address or HTTP error for endpoint: ${endpoint}`);
                    log(`[MTConnect] HTTP Status: ${err.response.status} ${err.response.statusText}`);
                    log(`[MTConnect] Response: ${JSON.stringify(err.response.data)}`);
                } else if (err.request) {
                    // Request was made but no response received (network error, timeout, etc.)
                    log(`[MTConnect] ERROR - No response from endpoint: ${endpoint}`);
                    log(`[MTConnect] Possible causes: incorrect hostname/IP, network issue, or service not running`);
                    log(`[MTConnect] Details: ${err.message}`);
                } else {
                    // Something else went wrong
                    log(`[MTConnect] ERROR - Failed to poll endpoint: ${endpoint}`);
                    log(`[MTConnect] Error: ${err.message}`);
                }
            }
        };

        // Poll all endpoints immediately on start
        await Promise.all(endpoints.map(endpoint => pollEndpoint(endpoint)));

        // Then poll all endpoints at regular intervals
        this.#pollInterval = setInterval(async () => {
            await Promise.all(endpoints.map(endpoint => pollEndpoint(endpoint)));
        }, interval);
    }

    open() {
        log(`${this._type} connection ready`);
        this.emit('open');
    }

    close(): void {
        log("Closing MTConnectConnection");
        
        // Clear the polling interval
        if (this.#pollInterval) {
            clearInterval(this.#pollInterval);
            this.#pollInterval = null;
        }
        
        this.#source.cancel("Stream Close Requested");
        this.emit("close");
    }
};
