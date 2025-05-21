/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import util from "util";

import {UUIDs} from "@amrc-factoryplus/service-client";

import { ACS, Edge } from "./uuids.js";

const { App, Class } = UUIDs;
const { Driver } = ACS;

/* Stock drivers with image definitions in the edge-agent Helm chart.
 * This is only for migrating existing deployments so this does not need
 * to be kept up to date as the Helm chart changes. */
const StockDriver = new Map([
    ["bacnet",              Driver.Bacnet],
    ["modbus",              Driver.Modbus],
    ["test",                Driver.Test],
    ["tplink-smartplug",    Driver.TPlinkSmartPlug],
]);

function image_tag (img) {
    return util.format("%s/%s:%s",
        img?.registry ?? "",
        img?.repository ?? "",
        img?.tag ?? "");
}

class MigrateAgents {
    constructor (ss) {
        const { fplus } = ss;

        this.cdb = fplus.ConfigDB;
        this.log = fplus.debug.bound("manager");
    }

    async run () {
        await this.fetch_existing_configs();
        await this.register_drivers();
        await this.migrate_agents();
        this.log("Manager migration complete");
    }

    async fetch_existing_configs () {
        const { cdb } = this;

        this.log("Fetching existing configs");

        this.eaconfigs = await cdb.get_all_configs(App.EdgeAgentConfig);
        this.connections = await cdb.get_all_configs(App.ConnectionConfiguration);
        this.drivers = await cdb.get_all_configs(App.DriverDefinition);

        /* We don't want all Deployments, only the Edge Agents */
        const agents = await cdb.class_members(Class.EdgeAgent);
        this.deployments = await Promise.all(
            agents.map(o =>
                cdb.get_config(Edge.App.Deployment, o)
                    .then(c => [o, c])))
            .then(es => new Map(es));
    }

    async register_drivers () {
        const { cdb, drivers } = this;

        this.log("Locating/registering Drivers");

        const tags = this.driver_by_image = new Map();
        const internal = this.internal_drivers = new Map();
        for (const [uuid, def] of drivers.entries()) {
            if (def.internal) {
                internal.set(def.internal.connType, [uuid, def.internal.details]);
                continue;
            }
            if (!def.image) continue;
            const tag = image_tag(def.image);
            tags.set(tag, uuid);
        }

        /* Find custom drivers not deployed with ACS. We assume all
         * these deployments are using some variation on the edge-agent
         * Helm chart. */
        for (const dep of this.deployments.values()) {
            if (!dep?.values?.image)
                continue;
            for (const image of Object.values(dep.values.image)) {
                const tag = image_tag(image);
                if (tags.has(tag)) continue;

                const name = image.repository ?? "(unknown driver)";
                const drv = await cdb.create_object(Edge.Class.Driver);
                await cdb.put_config(App.Info, drv, { name });
                await cdb.put_config(App.DriverDefinition, drv, { image });
                drivers.set(drv, { image });
                tags.set(tag, drv);

                this.log("Registered driver %s as %s", tag, drv);
            }
        }
    }

    find_driver (conn, values, dvals) {
        if (conn.connType != "Driver")
            return this.internal_drivers.get(conn.connType);

        const driver = (() => {
            const img = dvals?.image;
            if (!img) return;

            const image = values?.image?.[img];
            if (!image)
                return StockDriver.get(img);

            const tag = image_tag(image);
            return this.driver_by_image.get(tag);
        })();

        /* Fallback if we can't find deployment info */
        return [driver ?? Driver.External, "DriverDetails"];
    }

    async migrate_agents () {
        const { connections } = this;

        this.log("Registering Connections");

        for (const [agent, config] of this.eaconfigs.entries()) {
            let dirty = false;
            for (const conn of config.deviceConnections) {
                /* Assume if a connection has a UUID in the config it
                 * has been wholly migrated. */
                if (conn.uuid && connections.has(conn.uuid))
                    continue;

                dirty = true;

                /* XXX This is now the authoritative link between the EA
                 * and the Connection. This is incorrect; the EA config
                 * is a generated file and should not include any
                 * authoritative information. We need some sort of _Edge
                 * Agent request_ entry from which Deployment and Config
                 * are both derived. */
                conn.uuid = await this.register_connection(agent, conn);

                for (const device of conn.devices)
                    await this.register_device(agent, conn.uuid, device);
            }
            if (dirty)
                await this.update_deployment(agent, config);
        }
    }

    async register_connection (agent, conn) {
        const { cdb } = this;

        this.log("Registering connection %s of Edge Agent %s", conn.name, agent);

        const cconf = this.connection_config(agent, conn);
        const cobj = await cdb.create_object(Class.EdgeAgentConnection);
        await cdb.put_config(App.Info, cobj, { name: conn.name });
        await cdb.put_config(App.ConnectionConfiguration, cobj, cconf);
        this.connections.set(cobj, cconf);

        this.log("Registered as %s", cobj);
        return cobj;
    }

    deployment_config (values, dvals) {
        const ddevs = values?.driverDevices;
        const dmnts = dvals?.deviceMounts;
        const rv = {...dvals};

        delete rv.deviceMounts;
        delete rv.image;

        if (ddevs && dmnts) {
            const hps = [];
            for (const [tag, mountPath] of Object.entries(dmnts)) {
                const hostPath = ddevs[tag];
                if (!hostPath) continue;
                hps.push({ hostPath, mountPath });
            }
            if (hps.length)
                rv.hostPaths = hps;
        }

        return rv;
    }

    connection_config (edgeAgent, conn) {
        const dep = this.deployments.get(edgeAgent);

        const values = dep?.values;
        const dvals = values?.drivers?.[conn.name];

        const [driver, details] = this.find_driver(conn, values, dvals);
        const deployment = this.deployment_config(values, dvals);

        return {
            driver, edgeAgent, deployment,
            createdAt:  new Date().toISOString(),
            config:     conn[details] ?? {},
            source:     {
                payloadFormat:  conn.payloadFormat,
            },
            topology:   {
                cluster:        dep?.cluster,
                hostname:       dep?.hostname,
            },
        };
    }

    // Transform flat array of metrics into nested object structure
    transformOriginMap(tags) {
        // Field name mapping from old to new format
        const fieldMapping = {
            'address': 'Address',
            'path': 'Path',
            'method': 'Method',
            'type': 'Sparkplug_Type',
            'docs': 'Documentation',
            'recordToDB': 'Record_To_Historian',
            'engHigh': 'Eng_High',
            'engLow': 'Eng_Low',
            'engUnit': 'Eng_Unit',
            'deadBand': 'Deadband',
        };

        // Create the root object for the nested structure
        const nestedMap = {};

        // Process each tag
        for (const tag of tags) {
            // Skip tags without a Name
            if (!tag.Name) continue;

            // Split the name by '/' to get the path components
            const pathComponents = tag.Name.split('/');

            // Handle Schema_UUID and Instance_UUID at the root level
            if (pathComponents.length === 1 &&
                (pathComponents[0] === 'Schema_UUID' || pathComponents[0] === 'Instance_UUID')) {
                nestedMap[pathComponents[0]] = tag.value;
                continue;
            }

            // Create nested structure based on path components
            let current = nestedMap;
            for (let i = 0; i < pathComponents.length - 1; i++) {
                const component = pathComponents[i];
                if (!current[component]) {
                    current[component] = {};
                }
                current = current[component];
            }

            // Get the last component (actual field name)
            const lastComponent = pathComponents[pathComponents.length - 1];

            // Handle Schema_UUID and Instance_UUID at nested levels
            if (lastComponent === 'Schema_UUID' || lastComponent === 'Instance_UUID') {
                current[lastComponent] = tag.value;
                continue;
            }

            // For other fields, create an object with all properties
            if (!current[lastComponent]) {
                current[lastComponent] = {};
            }

            // Special handling for value - it should be a property of the object
            if (tag.value !== undefined && lastComponent !== 'Schema_UUID' && lastComponent !== 'Instance_UUID') {
                current[lastComponent]['Value'] = tag.value;
            }

            // Map all fields from the tag to the new format
            for (const [oldKey, newKey] of Object.entries(fieldMapping)) {
                if (tag[oldKey] !== undefined) {
                    // Special handling for boolean values to ensure they remain boolean
                    if (oldKey === 'recordToDB') {
                        current[lastComponent][newKey] = Boolean(tag[oldKey]);
                    } else {
                        current[lastComponent][newKey] = tag[oldKey];
                    }
                }
            }
        }

        return nestedMap;
    }

    async register_device(node, connection, device) {
        const { cdb } = this;

        this.log("Registering device %s of Edge Agent %s", device.deviceId, node);

        const schemaTag = device.tags.find(t => t.Name === "Schema_UUID");

        // Skip devices that don't have a schema (Schema_UUID is null)
        if (!schemaTag || !schemaTag.value) {
            this.log("Skipping device %s of Edge Agent %s - no schema UUID found", device.deviceId, node);
            return;
        }

        const dobj = await cdb.create_object(Class.Device);
        await cdb.put_config(App.Info, dobj, { name: device.deviceId });

        // Log the original tags for debugging
        this.log("Original device tags for %s: %s", device.deviceId, JSON.stringify(device.tags, null, 2));

        // Transform the flat array of tags into a nested object structure
        const transformedOriginMap = this.transformOriginMap(device.tags);

        // Log the transformed originMap for debugging
        this.log("Transformed originMap for %s: %s", device.deviceId, JSON.stringify(transformedOriginMap, null, 2));

        const dconf = {
            connection, node,
            createdAt:      new Date().toISOString(),
            originMap:      transformedOriginMap,
            schema:         schemaTag.value,
            sparkplugName:  device.deviceId,
        };
        await cdb.put_config(App.DeviceInformation, dobj, dconf);

        this.log("Registered as %s", dobj);
    }

    async update_deployment (agent, config) {
        const { cdb } = this;

        this.log("Updating config for Edge Agent %s", agent);
        await cdb.put_config(App.EdgeAgentConfig, agent, config);

        /* We must fix up the Deployment to be compatible with the new
         * Helm chart. This means doing the work the Manager does when
         * it updates the Deployment. */
        const deployment = this.deployments.get(agent);

        /* We don't know why this Deployment didn't exist. It is not
         * safe to simply create it. The Manager will do so but only
         * when the user takes explicit action. */
        if (!deployment) return;

        const connections = config.deviceConnections;

        const values = deployment.values ??= {};
        delete values.image;
        delete values.driverDevices;

        values.drivers = Object.fromEntries(connections
            .map(dc => [dc.name, this.connections.get(dc.uuid)])
            .map(([n, c]) => [n, c, this.drivers.get(c.driver).image])
            .filter(([n, c, i]) => i)
            .map(([n, c, image]) => [n, { ...(c.deployment ?? {}), image }]));

        this.log("Updating deployment for Edge Agent %s", agent);
        await cdb.put_config(Edge.App.Deployment, agent, deployment);
    }
}

export function migrate_edge_agent_config(ss) {
    return new MigrateAgents(ss).run();
}

