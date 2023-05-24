/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import {SparkplugNode} from "../sparkplugNode.js";
import {Device, DeviceConnection, deviceOptions} from "../device.js";
import {log} from "../helpers/log.js";
import {getOpcSecurityMode, getOpcSecurityPolicy, Metrics, OPCUADataType} from "../helpers/typeHandler.js";

import {
    AttributeIds,
    ClientSession,
    ClientSubscription,
    CreateSubscriptionRequestLike,
    MonitoredItemNotification,
    OPCUAClient,
    OPCUAClientOptions,
    ReadValueIdOptions,
    resolveNodeId,
    TimestampsToReturn,
    UserIdentityInfo,
    UserTokenType,
    WriteValueOptions
} from "node-opcua";

// Example here: https://github.com/node-opcua/node-opcua/blob/v2.1.3/documentation/sample_client.js

export interface opcUaConnDetails {
    useCredentials: boolean,
    username: string,
    password: string,
    securityMode: string,
    securityPolicy: string,
    endpoint: string
}

export interface changedMetricType {
    [key: string]: any;
}


export class OPCUAConnection extends DeviceConnection {
    #subscription: ClientSubscription
    #subscriptionOptions: CreateSubscriptionRequestLike
    #client: OPCUAClient
    #options: OPCUAClientOptions
    #credentials: UserIdentityInfo
    #endpointUrl: string
    #session: ClientSession | null

    constructor(type: string, connDetails: opcUaConnDetails) {
        super(type);
        this.#subscription = new ClientSubscription();
        this.#subscriptionOptions = {
            maxNotificationsPerPublish: 1000,
            publishingEnabled: true,
            requestedLifetimeCount: 100,
            requestedMaxKeepAliveCount: 10,
            requestedPublishingInterval: 1000
        }
        // Set credentials if specified
        if (connDetails.useCredentials) {
            this.#credentials = {
                userName: connDetails.username,
                password: connDetails.password,
                type: UserTokenType.UserName
            }
        } else {
            this.#credentials = {
                type: UserTokenType.Anonymous
            }
        }
        this.#options = {
            applicationName: `acs-edge`,
            keepSessionAlive: true,
            connectionStrategy: {
                initialDelay: 1000,
                maxDelay: 20000
            },
            securityMode: getOpcSecurityMode(connDetails.securityMode),
            securityPolicy: getOpcSecurityPolicy(connDetails.securityPolicy),
            endpointMustExist: false
        };
        this.#client = OPCUAClient.create(this.#options);
        this.#endpointUrl = connDetails.endpoint;

        this.#client.on("start_reconnection", function () {
            log("Trying to reconnect to OPC UA server...")
        });
        this.#client.on("connecting", function () {
            log("Trying to connect to OPC UA server...")
        });
        this.#client.on("backoff", function (nb, delay) {
            console.log(`Connection to the OPC UA server failed for the ${nb} time. Retrying in ${delay} ms`);
        });

        this.#session = null;
    }

    async open() {
        try {
            await this.#client.connect(this.#endpointUrl);
            this.#session = await this.#client.createSession(this.#credentials);
            this.emit('open');
            log(`OPC UA connected to ${this.#endpointUrl}`)
        } catch (e) {
            console.log(e);
        }

    }

    readMetrics(metrics: Metrics, payloadFormat?: string) {
        const oldVals: any[] = [];
        let items: ReadValueIdOptions[] = [];
        for (let i = 0; i < metrics.length; i++) {
            const metric = metrics.array[i];
            if (typeof metric.properties !== "undefined") {
                oldVals.push(metric.value);
                items.push({
                    nodeId: metric.properties.address.value as string,
                    attributeId: AttributeIds.Value
                });
            }
        }

        if (this.#session) {
            this.#session.read(items, 0, (err, dataValues) => {
                if (err) {
                    console.log(err);
                } else if (typeof dataValues !== "undefined") {
                    for (let i = 0; i < dataValues.length; i++) {
                        metrics.array[i].value = dataValues[i].value.value;
                        metrics.array[i].timestamp = Date.now();
                    }
                }
            });
        }
        return oldVals;
    }

    async writeMetrics(metrics: Metrics, writeCallback: Function, payloadFormat?: string, delimiter?: string) {
        let items: WriteValueOptions[] = await Promise.all(metrics.array.map(metric => {
            let obj: WriteValueOptions = {};
            if (typeof metric.properties !== "undefined") {
                obj = {
                    nodeId: metric.properties.address.value as string,
                    attributeId: AttributeIds.Value,
                    value: {
                        value: {
                            dataType: OPCUADataType[metric.type], // Need to map Sparkplug Datatype to OPC UA datatype
                            value: metric.value
                        }
                    }
                }
            }
            return obj
        }))
        let isErr = false;
        const statusCodes = this.#session ? await this.#session.write(items) : [{
            value: -1,
            description: "No OPC UA client session"
        }];
        for (let i = 0; i < statusCodes.length; i++) {
            if (statusCodes[i].value !== 0) {
                isErr = true;
                writeCallback(new Error(statusCodes[i].description));
                break;
            }
        }
        if (!isErr) writeCallback();
    }

    startSubscription(
        metrics: Metrics,
        payloadFormat: string,
        delimiter: string,
        interval: number,
        deviceId: string,
        subscriptionStartCallback: Function) {
        this.#subscriptionOptions.requestedPublishingInterval = interval;
        if (this.#session) {
            this.#session.createSubscription2(this.#subscriptionOptions, (err, subscription) => {
                if (typeof subscription !== "undefined") {
                    this.#subscription = subscription;
                    this.#subscription
                        .on("started", () => {
                            log(
                                "OPC UA metric subscription started - subscriptionId=" +
                                this.#subscription.subscriptionId
                            );
                        })
                        .on("keepalive", function () {
                            log("OPC UA subscription keepalive");
                        })
                        .on("terminated", function () {
                            log("OPC UA subscription terminated");
                        });
                    const itemsToMonitor: ReadValueIdOptions[] = [];
                    metrics.addresses.forEach(addr => {
                        itemsToMonitor.push({
                            nodeId: resolveNodeId(addr),
                            attributeId: AttributeIds.Value
                        })
                    })

                    const monitoringParameters = {
                        samplingInterval: interval,
                        discardOldest: true,
                        queueSize: 10
                    };

                    this.#subscription.monitorItems(
                        itemsToMonitor,
                        monitoringParameters,
                        TimestampsToReturn.Both
                    );

                    this.#subscription.on("received_notifications", (msg) => {
                        // log(msg.toString())
                        if (msg.notificationData) {
                            msg.notificationData.forEach(dataChangeNotification => {
                                let changedMetrics: changedMetricType = {};
                                (dataChangeNotification as any).monitoredItems.forEach(
                                    (monitoredItemNotification: MonitoredItemNotification) => {
                                        const monitoredItem = this.#subscription.monitoredItems[monitoredItemNotification.clientHandle]
                                        const nodeId = monitoredItem.itemToMonitor.nodeId.toString();
                                        changedMetrics[nodeId] = monitoredItemNotification.value.value.value;
                                    })
                                // this.emit('asyncData', changedMetrics);
                                log(JSON.stringify(changedMetrics));
                                this.emit('data', changedMetrics, false)
                            })
                        }
                    })
                }
            });
            log(`Subscription created for ${metrics.length} tags on ${this._type}`);
        }
    }

    async close() {
        try {
            if (this.#session) {
                await this.#session.close();
            }
            await this.#client.disconnect();
            this.emit('close');
        } catch (e) {
            console.log(e);
        }
    }
}


export class OPCUADevice extends (Device) {
    devConn: OPCUAConnection

    constructor(spClient: SparkplugNode, devConn: OPCUAConnection, options: deviceOptions) {
        super(spClient, devConn, options);
        this.devConn = devConn;

        this._metrics.add(options.metrics);

        try {
            this.devConn.on('open', () => {
                this._isConnected = true;
                log(`${this._name} ready`);
            })


            // this.devConn.on('asyncData', (changedMetrics: changedMetricType) => {
            //   let updatedMetrics:sparkplugMetric[] = [];
            //   for (const addr in changedMetrics) {
            //     this._metrics.setValueByAddrPath(addr, '', changedMetrics[addr]);
            //     updatedMetrics.push(this._metrics.getByAddrPath(addr, ''));
            //   }
            //   this.onConnData(updatedMetrics);
            // })
        } catch (e) {
            console.log(e);
        }
    }
}