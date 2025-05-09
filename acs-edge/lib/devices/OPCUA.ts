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
    NodeClass,
    DataValue
} from "node-opcua";

import { ScoutDriverDetails } from "../scout.js";

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

    public async scoutAddresses(driverDetails: ScoutDriverDetails): Promise<object> {
        const clientForScout = OPCUAClient.create(this.#options);
        const discoveredAddresses: Map<string, object> = new Map<string, object>();
        let sessionForScout: ClientSession | null = null; // Track session
    
        try {
            // Connect to OPC UA Server
            await clientForScout.connect(this.#endpointUrl);
            log(`Scout connected to OPC UA server at ${this.#endpointUrl}`);
    
            // Create Session
            sessionForScout = await clientForScout.createSession(this.#credentials);
            log(`Scout session created for OPC UA node discovery.`);
    
            // Read NamespaceArray (i=2255) to get all available namespaces
            const namespaceArrayNodeId = new NodeId(NodeIdType.NUMERIC, 2255, 0);
            const dataValues: DataValue[] = await sessionForScout.read([
                {
                    nodeId: namespaceArrayNodeId,
                    attributeId: AttributeIds.Value
                }
            ]);
            const namespaceArray: string[] = dataValues[0].value.value;
            log(`Discovered Namespaces: ${namespaceArray.join(', ')}`);
    
            // Start browsing from the Root Node (ns=0;i=84)
            const NodeIDToStartSearchFrom = new NodeId(NodeIdType.NUMERIC, 84, 0);
    
            log('Starting to browse OPC UA nodes');
            const startTime = Date.now();
            const discoveredReferences = await this.browseOPCUANodes(sessionForScout, NodeIDToStartSearchFrom);
            const endTime = Date.now();
            log(`Browsing completed in ${(endTime - startTime) / 1000} seconds`);
    
            log('Starting to format OPC UA reference into objects');
            const addressObjects = await Promise.all(
                discoveredReferences.map(reference => this.getAddressObject(reference, namespaceArray, sessionForScout))
            );
    
            addressObjects.forEach(([key, value]) => discoveredAddresses.set(key, value));
            log('Done formatting OPC UA reference into objects');
    
            return Object.fromEntries(discoveredAddresses);
        } catch (err) {
            log(`Error during OPC UA Scouting: ${(err as Error).message}`);
            throw err;
        } finally {
            if (sessionForScout) {
                await sessionForScout.close().catch(err => log(`Error closing session: ${err.message}`));
            }
            await clientForScout.disconnect().catch(err => log(`Error disconnecting client: ${err.message}`));
        }
    }
    

    async browseOPCUANodes(session, nodeId: NodeId): Promise<ReferenceDescription[]> {
        try {
            const browseResult: BrowseResult = await session.browse(nodeId);

            if (!browseResult || !browseResult.references || browseResult.references.length === 0) {
                log(`No child nodes found for: ${nodeId.toString()}`);
                return [];
            }

            const allNodes: Set<ReferenceDescription> = new Set();

            // Iterate through each reference found during browsing
            for (const reference of browseResult.references) {
                /***
                 * 
                 * Unspecified - 0 No value is specified.
                 * Object - 1 The Node is an Object.
                 * Variable - 2 The Node is a Variable.
                 * Method - 4 The Node is a Method.
                 * ObjectType - 8 The Node is an ObjectType.
                 * VariableType - 16 The Node is a VariableType.
                 * ReferenceType - 32 The Node is a ReferenceType.
                 * DataType - 64 The Node is a DataType.
                 * View - 128 The Node is a View.
                 * ***/

                if ([4, 8, 16, 32, 64].includes(reference.nodeClass)) {
                    continue;
                }

                // Browse on this node to check if it has children (skip Variable class as it's a Leaf node)
                if (reference.nodeClass !== 2) {
                    const childBrowseResult: BrowseResult = await session.browse(reference.nodeId);
                    if (childBrowseResult.references && childBrowseResult.references.length > 0) {
                        // Recursively browse child nodes
                        const childNodes = await this.browseOPCUANodes(session, reference.nodeId);
                        childNodes.forEach(childNode => allNodes.add(childNode));
                    }
                }
                allNodes.add(reference);
            }

            return Array.from(allNodes);
        } catch (err) {
            log(`Error when browsing OPC UA nodes for ${nodeId} with error ${(err as Error).message}`);
            return [];
        }
    }


    async getAddressObject(reference: ReferenceDescription, namespaceArray: string[], session): Promise<[string, object]> {
        try {
            // Try to get DataType if available
            const dataType = await this.getDataType(reference.nodeId, session);

            // Validate namespace index
            const namespaceURI = namespaceArray[reference.nodeId.namespace] || "Unknown Namespace";

            return [
                reference.nodeId.toString(),
                {
                    name: reference.browseName.toString(),
                    nodeClassID: reference.nodeClass,
                    nodeClassName: NodeClass[reference.nodeClass],
                    namespace: reference.nodeId.namespace,
                    namespaceURI: namespaceURI,
                    ...(dataType ? { dataType } : {}) // Include dataType only if available
                }
            ];
        } catch (err) {
            log(`Error retrieving address object for ${reference.nodeId.toString()}: ${(err as Error).message}`);
            return [
                reference.nodeId.toString(),
                {
                    name: reference.browseName.toString(),
                    nodeClassID: reference.nodeClass,
                    nodeClassName: NodeClass[reference.nodeClass],
                    namespace: reference.nodeId.namespace,
                    namespaceURI: namespaceArray[reference.nodeId.namespace] || "Unknown Namespace",
                }
            ];
        }
    }


    async getDataType(nodeId: NodeId, session): Promise<string | null> {
        try {
            // Read the DataType attribute of the node
            const resDataTypeNodeId = await session.read({
                nodeId: nodeId,
                attributeId: AttributeIds.DataType,
            });

            // Validate response
            if (!resDataTypeNodeId?.value?.value) {
                return null;
            }

            const dataTypeNodeId = resDataTypeNodeId.value.value;

            // Read the DisplayName of the DataType node
            const resDataTypeDisplayName = await session.read({
                nodeId: dataTypeNodeId,
                attributeId: AttributeIds.DisplayName,
            });

            // Validate display name response
            if (!resDataTypeDisplayName?.value?.value?.text) {
                return null; // Return null if display name is missing
            }

            // Return the extracted display name
            return resDataTypeDisplayName.value.value.text;
        } catch (err) {
            log(`Error retrieving data type for ${nodeId.toString()}: ${(err as Error).message}`);
            return "";
        }
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
