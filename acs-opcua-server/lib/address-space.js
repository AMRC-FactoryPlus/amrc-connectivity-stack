/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import {
    DataType,
    Variant,
    StatusCodes,
    AccessLevelFlag,
    makeNodeId,
    coerceNodeId
} from "node-opcua";

export class AddressSpaceBuilder {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.influxClient = opts.influxClient;
        this.authHandler = opts.authHandler;
        this.log = this.fplus.debug.bound("address-space");

        this.namespace = null;
        this.rootFolder = null;
    }

    /**
     * Build the OPC UA address space from InfluxDB data
     * @param {Object} addressSpace - The OPC UA address space
     */
    async buildAddressSpace(addressSpace) {
        this.log("Building OPC UA address space...");

        // Create our namespace
        this.namespace = addressSpace.registerNamespace("urn:amrc:factoryplus:uns");
        this.log(`Created namespace with index: ${this.namespace.index}`);

        // Create root folder for Factory+ UNS data
        const objectsFolder = addressSpace.rootFolder.objects;
        this.rootFolder = this.namespace.addFolder(objectsFolder, {
            browseName: "Factory+",
            displayName: "Factory+",
            description: "Factory+ Unified Namespace data from InfluxDB"
        });

        // Build the hierarchy: Groups -> Nodes -> Devices -> Paths -> Measurements
        await this.buildGroupHierarchy();

        this.log("Address space built successfully");
    }

    /**
     * Build the group hierarchy
     */
    async buildGroupHierarchy() {
        try {
            const groups = await this.influxClient.getGroups();
            this.log(`Found ${groups.length} groups`);

            for (const group of groups) {
                await this.buildGroupFolder(group);
            }
        } catch (error) {
            this.log(`Error building group hierarchy: ${error.message}`);
        }
    }

    /**
     * Build a folder for a specific group
     * @param {string} groupName - The group name
     */
    async buildGroupFolder(groupName) {
        try {
            const groupFolder = this.namespace.addFolder(this.rootFolder, {
                browseName: groupName,
                displayName: groupName,
                description: `Sparkplug Group: ${groupName}`
            });

            const nodes = await this.influxClient.getNodes(groupName);
            this.log(`Group ${groupName} has ${nodes.length} nodes`);

            for (const node of nodes) {
                await this.buildNodeFolder(groupFolder, groupName, node);
            }
        } catch (error) {
            this.log(`Error building group folder for ${groupName}: ${error.message}`);
        }
    }

    /**
     * Build a folder for a specific node
     * @param {Object} parentFolder - The parent group folder
     * @param {string} groupName - The group name
     * @param {string} nodeName - The node name
     */
    async buildNodeFolder(parentFolder, groupName, nodeName) {
        try {
            const nodeFolder = this.namespace.addFolder(parentFolder, {
                browseName: nodeName,
                displayName: nodeName,
                description: `Sparkplug Node: ${nodeName} in Group: ${groupName}`
            });

            const devices = await this.influxClient.getDevices(groupName, nodeName);
            this.log(`Node ${groupName}/${nodeName} has ${devices.length} devices`);

            for (const device of devices) {
                await this.buildDeviceFolder(nodeFolder, groupName, nodeName, device);
            }
        } catch (error) {
            this.log(`Error building node folder for ${groupName}/${nodeName}: ${error.message}`);
        }
    }

    /**
     * Build a folder for a specific device
     * @param {Object} parentFolder - The parent node folder
     * @param {string} groupName - The group name
     * @param {string} nodeName - The node name
     * @param {string} deviceName - The device name
     */
    async buildDeviceFolder(parentFolder, groupName, nodeName, deviceName) {
        try {
            const deviceFolder = this.namespace.addFolder(parentFolder, {
                browseName: deviceName,
                displayName: deviceName,
                description: `Sparkplug Device: ${deviceName} on Node: ${nodeName}`
            });

            const paths = await this.influxClient.getPaths(groupName, nodeName, deviceName);
            this.log(`Device ${groupName}/${nodeName}/${deviceName} has ${paths.length} paths`);

            for (const path of paths) {
                await this.buildPathFolder(deviceFolder, groupName, nodeName, deviceName, path);
            }
        } catch (error) {
            this.log(`Error building device folder for ${groupName}/${nodeName}/${deviceName}: ${error.message}`);
        }
    }

    /**
     * Build a folder for a specific path
     * @param {Object} parentFolder - The parent device folder
     * @param {string} groupName - The group name
     * @param {string} nodeName - The node name
     * @param {string} deviceName - The device name
     * @param {string} pathName - The path name
     */
    async buildPathFolder(parentFolder, groupName, nodeName, deviceName, pathName) {
        try {
            // Handle nested paths by creating folder hierarchy
            const pathParts = pathName.split('/');
            let currentFolder = parentFolder;

            // Create folders for each path segment except the last one
            for (let i = 0; i < pathParts.length; i++) {
                const pathPart = pathParts[i];

                // Check if folder already exists
                let existingFolder = null;
                for (const child of currentFolder.getComponents()) {
                    if (child.browseName.name === pathPart) {
                        existingFolder = child;
                        break;
                    }
                }

                if (existingFolder) {
                    currentFolder = existingFolder;
                } else {
                    currentFolder = this.namespace.addFolder(currentFolder, {
                        browseName: pathPart,
                        displayName: pathPart,
                        description: `Path segment: ${pathPart}`
                    });
                }
            }

            const measurements = await this.influxClient.getMeasurements(groupName, nodeName, deviceName, pathName);
            this.log(`Path ${groupName}/${nodeName}/${deviceName}/${pathName} has ${measurements.length} measurements`);

            for (const measurement of measurements) {
                await this.buildMeasurementVariable(currentFolder, groupName, nodeName, deviceName, pathName, measurement);
            }
        } catch (error) {
            this.log(`Error building path folder for ${groupName}/${nodeName}/${deviceName}/${pathName}: ${error.message}`);
        }
    }

    /**
     * Build a variable for a specific measurement
     * @param {Object} parentFolder - The parent path folder
     * @param {string} groupName - The group name
     * @param {string} nodeName - The node name
     * @param {string} deviceName - The device name
     * @param {string} pathName - The path name
     * @param {string} measurementName - The measurement name
     */
    async buildMeasurementVariable(parentFolder, groupName, nodeName, deviceName, pathName, measurementName) {
        try {
            const fullPath = `${groupName}/${nodeName}/${deviceName}/${pathName}/${measurementName}`;

            // Get a sample value to determine the data type
            let dataType = DataType.String;
            let initialValue = null;

            try {
                const sampleValue = await this.influxClient.getCurrentValue(fullPath);
                if (sampleValue !== null) {
                    initialValue = sampleValue;
                    dataType = this.getOPCUADataType(sampleValue);
                }
            } catch (error) {
                this.log(`Could not get sample value for ${fullPath}: ${error.message}`);
            }

            const variable = this.namespace.addVariable({
                componentOf: parentFolder,
                browseName: measurementName,
                displayName: measurementName,
                description: `Measurement: ${measurementName} from ${fullPath}`,
                dataType: dataType,
                value: {
                    get: () => {
                        return new Variant({
                            dataType: dataType,
                            value: initialValue
                        });
                    }
                },
                accessLevel: AccessLevelFlag.CurrentRead | AccessLevelFlag.TimestampRead,
                userAccessLevel: AccessLevelFlag.CurrentRead | AccessLevelFlag.TimestampRead
            });

            // Store the full path as a custom property for data source lookup
            variable._fullPath = fullPath;

            this.log(`Created variable for measurement: ${fullPath}`);
        } catch (error) {
            this.log(`Error building measurement variable for ${measurementName}: ${error.message}`);
        }
    }

    /**
     * Determine OPC UA data type from a value
     * @param {any} value - The value to analyze
     * @returns {DataType} The appropriate OPC UA data type
     */
    getOPCUADataType(value) {
        if (typeof value === "boolean") {
            return DataType.Boolean;
        } else if (typeof value === "string") {
            return DataType.String;
        } else if (Number.isInteger(value)) {
            if (value >= -2147483648 && value <= 2147483647) {
                return DataType.Int32;
            } else {
                return DataType.Int64;
            }
        } else if (typeof value === "number") {
            return DataType.Double;
        } else {
            return DataType.String; // Default fallback
        }
    }

    /**
     * Refresh the address space by rebuilding it
     */
    async refreshAddressSpace() {
        this.log("Refreshing address space...");

        // Clear existing structure
        if (this.rootFolder) {
            // Remove all children
            const children = this.rootFolder.getComponents();
            for (const child of children) {
                this.namespace.deleteNode(child);
            }
        }

        // Rebuild
        await this.buildGroupHierarchy();

        this.log("Address space refreshed");
    }

    /**
     * Get the namespace
     * @returns {Object} The OPC UA namespace
     */
    getNamespace() {
        return this.namespace;
    }

    /**
     * Get the root folder
     * @returns {Object} The root folder
     */
    getRootFolder() {
        return this.rootFolder;
    }
}
