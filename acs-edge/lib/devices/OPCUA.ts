/*
 *  Factory+ / AMRC Connectivity Stack (ACS) Edge component
 *  Copyright 2023 AMRC
 */

import { SparkplugNode } from "../sparkplugNode.js";
import { Device, DeviceConnection, deviceOptions } from "../device.js";
import { log } from "../helpers/log.js";
import { getOpcSecurityMode, getOpcSecurityPolicy, Metrics, OPCUADataType } from "../helpers/typeHandler.js";

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
    WriteValueOptions,
    BrowseResult,
    NodeId,
    NodeIdType,
    ReferenceDescription,
    NodeClass
} from "node-opcua";
import { opcuaScoutDetails } from "../scout.js";
import { UniqueDictionary } from "../helpers/uniquedictionary.js";

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
            requestedPublishingInterval: 1000,
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

    public async scoutAddresses(scoutDetails: opcuaScoutDetails): Promise<UniqueDictionary<string, object>> {
        const clientForScout = OPCUAClient.create(this.#options);
        const discoveredAddresses: UniqueDictionary<string, object> = new UniqueDictionary<string, object>();

        try {
            await clientForScout.connect(this.#endpointUrl);
            log(`Scout connected to OPC UA server at ${this.#endpointUrl}`)

            const sessionForScout = await clientForScout.createSession(this.#credentials);
            log(`Scout session created for OPC UA node discovery.`);;

            const NodeIDToStartSearchFrom = new NodeId(scoutDetails.NodeIdType, scoutDetails.Identifier, scoutDetails.NamespaceIndex);
            
            const discoveredReferences: ReferenceDescription[] = await this.browseOPCUANodes(sessionForScout, NodeIDToStartSearchFrom);

            discoveredReferences.forEach(reference => discoveredAddresses.add(...this.getAddressObject(reference)));

            await sessionForScout.close();
            await clientForScout.disconnect();

            return discoveredAddresses
        } catch (err) {
            log(`Error during OPC UA Scouting ${(err as Error).message}`);
            await clientForScout.disconnect();
            return discoveredAddresses;
        }
    }

    async browseOPCUANodes(session, nodeId: NodeId): Promise<ReferenceDescription[]> {
        try {
            const browseResult: BrowseResult = await session.browse(nodeId);

            // If no references found, just return an empty array
            if (!browseResult || !browseResult.references || browseResult.references.length === 0) {
                log(`No child nodes found for: ${nodeId.toString()}`);
                return [];
            }

            const variableNodes: Set<ReferenceDescription> = new Set();

            // Iterate through each reference found during browsing
            for (const reference of browseResult.references) {
                if (reference.nodeClass === 2) {
                    variableNodes.add(reference);
                }
                // Object = 1, ObjectType = 8, and ReferenceType = 32 can have child nodes 
                else if (reference.nodeClass === 1 || reference.nodeClass === 8 || reference.nodeClass === 32) {
                    // Recursively browse the child nodes
                    const childNodes = await this.browseOPCUANodes(session, reference.nodeId);
                    childNodes.forEach(childNode => variableNodes.add(childNode));
                }

            }

            return Array.from(variableNodes);

        } catch (err) {
            log(`Error when browsing for OPCUA nodes for ${nodeId} with error ${(err as Error).message}`);
            return [];
        }
    }

    getAddressObject(reference: ReferenceDescription): [string, object]{
        return [
            reference.nodeId.toString(),
            {
                name: reference.browseName.toString(),
                nodeClassID: reference.nodeClass,
                nodeClassName: NodeClass[reference.nodeClass]
            }
        ]
    }

    readMetrics(metrics: Metrics, payloadFormat?: string) {
        const oldVals: any[] = [];
        let items: ReadValueIdOptions[] = [];
        for (let i = 0; i < metrics.length; i++) {
            const metric = metrics.array[i];
            // Only add the metrics to the array to monitor if they have an address, otherwise the node-opcua library will throw an error
            if (typeof metric.properties !== "undefined" && metric.properties.address?.value) {
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

    async startSubscription(
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
                            // log("OPC UA subscription keepalive");
                        })
                        .on("terminated", function () {
                            log("OPC UA subscription terminated");
                        });
                    const itemsToMonitor: ReadValueIdOptions[] = [];

                    metrics.addresses.forEach(addr => {
                        if (addr !== 'undefined') {
                            itemsToMonitor.push({
                                nodeId: resolveNodeId(addr),
                                attributeId: AttributeIds.Value
                            })
                        }
                    })

                    this.#subscription.monitorItems(
                        itemsToMonitor,
                        {
                            samplingInterval: interval,
                            discardOldest: false,
                            queueSize: 1000
                        },
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
