/*
 * ACS service setup
 * Migrate Manager edge agent config to devices and connections in the ConfigDB
 * Copyright 2025 University of Sheffield AMRC
 */

import {UUIDs} from "@amrc-factoryplus/service-client";

export async function migrate_edge_agent_config(ss) {

    const {fplus} = ss;
    const cdb = fplus.ConfigDB;
    const log = fplus.debug.bound("manager");
    const MIGRATION_OBJECT_UUID = "d0208d04-a17d-4281-94ef-496b9f6aeede";

    // Check the migration status.
    const privateConfig = await cdb.get_config(UUIDs.App.ServiceSetup, MIGRATION_OBJECT_UUID);
    if(
        privateConfig && privateConfig.migrated === true
    ){
        log("Nothing to migrate.")
        return;
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
    await cdb.create_object(UUIDs.Class.Class, UUIDs.Class.Private);
    await cdb.put_config(UUIDs.App.Info, UUIDs.Class.Private,
        { name: "Private configuration" });

    // create an instance of the private class.
    await cdb.create_object(UUIDs.Class.Private, MIGRATION_OBJECT_UUID);
    await cdb.put_config(UUIDs.App.Info, MIGRATION_OBJECT_UUID, { name: "Migration Information" });

    // Insert the migration config.
    await cdb.put_config(UUIDs.App.ServiceSetup, MIGRATION_OBJECT_UUID, {
        name: "v4-Migration",
        timestamp: new Date().toISOString(),
        migrated: true,
    });
}

