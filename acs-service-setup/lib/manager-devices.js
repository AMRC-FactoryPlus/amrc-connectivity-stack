/*
 * ACS service setup
 * Migrate Manager edge agent config to devices and connections in the ConfigDB
 * Copyright 2025 University of Sheffield AMRC
 */

import {UUIDs} from "@amrc-factoryplus/service-client";

export async function migrate_edge_agent_config(ss) {
    const Class = {
        Private:        "eda329ca-4e55-4a92-812d-df74993c47e2",
    };

    const App = {
        ServiceSetup: "5b47881c-b012-4040-945c-eacafca539b2",
    }

    const {fplus} = ss;
    const cdb = fplus.ConfigDB;
    const log = fplus.debug.bound("manager");

    // Check the migration status.
    const privateConfigUUIDs = await cdb.list_configs(App.ServiceSetup);
    for (const uuid of privateConfigUUIDs){
        const privateConfig = await cdb.get_config(App.ServiceSetup, uuid);
        if("name" in privateConfig &&
            privateConfig.name === "v4-Migration" &&
            privateConfig.migrated === true
        ){
            log("No migration required.")
            return;
        }
    }

    const edgeAgentConfigUUIDs = await cdb.list_configs(UUIDs.App.EdgeAgentConfig);
    const driverUUIDs = await cdb.list_configs(UUIDs.App.DriverDefinition);
    const drivers = {};
    log(JSON.stringify(driverUUIDs));
    // Find and build driver name lookup.
    for (const driverUUID of driverUUIDs){
        const driverInfo = await cdb.get_config(UUIDs.App.Info, driverUUID);
        drivers[driverInfo.name] = driverUUID;
    }

    for (const uuid of edgeAgentConfigUUIDs) {
        const edgeAgentConfig = await cdb.get_config(UUIDs.App.EdgeAgentConfig, uuid);
        const edgeDeploymentConfig = await cdb.get_config(UUIDs.App.EdgeAgentDeployment, uuid);
        // TODO: add a check to skip config if it already exists in the new apps
        for (const connection of edgeAgentConfig.deviceConnections) {
            const connectionObjectUUID = await cdb.create_object(UUIDs.Class.EdgeAgentConnection);
            await cdb.put_config(UUIDs.App.Info, connectionObjectUUID, {
                name: connection.name
            });
            // Remove any special characters.
            const connectionConfigKey = (connection.connType).replace(/[^a-zA-Z0-9]/g, '');
            // Insert into connection config
            const connectionConfig = {
                config: connection[(connectionConfigKey + "ConnDetails")],
                createdAt: new Date().toISOString(),
                deployment: {},
                driver: drivers[connectionConfigKey],
                edgeAgent: uuid,
                source: {
                    payloadFormat: connection.payloadFormat
                },
                topology: {
                    cluster: edgeDeploymentConfig.cluster,
                    host: edgeDeploymentConfig.hostname,
                    node: uuid,
                }
            }
            await cdb.put_config(UUIDs.App.ConnectionConfiguration, connectionObjectUUID, connectionConfig);
            // Migrate device information
            for (const device of connection.devices){
                // create object
                const deviceObjectUUID = await cdb.create_object(UUIDs.Class.Device);
                // create object information
                await cdb.put_config(UUIDs.App.Info, deviceObjectUUID, {
                    name: device.deviceId
                });
                // Find the schema uuid tag.
                const schemaTag = device.tags.find(t => t.Name === "Value/Schema_UUID");

                const deviceInformationPayload = {
                    connection: connectionObjectUUID,
                    createdAt: new Date().toISOString(),
                    node: uuid,
                    originMap: device.tags,
                    schema: schemaTag.value,
                    sparkplugName: device.deviceId,
                };
                // Insert the config.
                await cdb.put_config(UUIDs.App.DeviceInformation, deviceObjectUUID, deviceInformationPayload);
            }

        }
    }

    // Set migration status
    log("Creating required Classes");
    // Make sure the class exists.
    await cdb.create_object(UUIDs.Class.Class, Class.Private);
    await cdb.put_config(UUIDs.App.Info, Class.Private,
        { name: "Private configuration" });

    // create an instance of the private class.
    const uuid = await cdb.create_object(Class.Private);
    await cdb.put_config(UUIDs.App.Info, uuid, { name: "Migration Information" });

    // Insert the migration config.
    await cdb.put_config(App.ServiceSetup, uuid, {
        name: "v4-Migration",
        timestamp: new Date().toISOString(),
        migrated: true,
    });
}

