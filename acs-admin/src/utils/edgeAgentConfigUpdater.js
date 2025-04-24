/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { UUIDs } from '@amrc-factoryplus/service-client'
import { useDeviceStore } from '@/store/useDeviceStore'
import { useConnectionStore } from '@/store/useConnectionStore'
import { useServiceClientStore } from '@/store/serviceClientStore.js'
import { useDriverStore } from '@/store/useDriverStore.js'
import { storeReady } from '@/store/useStoreReady.js'

/**
 * Creates an array of tags from the origin map for the edge agent config
 * @param {Object} originMap - The origin map to create tags from
 * @returns {Array} - Array of tags
 */
function createTagsFromOriginMap(originMap) {
  const tags = []

  // Add Schema_UUID and Instance_UUID tags
  if (originMap.Schema_UUID) {
    tags.push({
      Name: 'Schema_UUID',
      type: 'UUID',
      method: 'GET',
      value: originMap.Schema_UUID,
      docs: 'A reference to the schema used for this object.',
      recordToDB: true
    })
  }

  if (originMap.Instance_UUID) {
    tags.push({
      Name: 'Instance_UUID',
      type: 'UUID',
      method: 'GET',
      value: originMap.Instance_UUID,
      docs: 'A reference to the instance of this object.',
      recordToDB: true
    })
  }

  // Process the rest of the origin map recursively
  processOriginMapObject(originMap, '', tags)

  return tags
}

/**
 * Recursively processes an object in the origin map to extract tags
 * @param {Object} obj - The object to process
 * @param {string} path - The current path in the object
 * @param {Array} tags - The array of tags to add to
 */
function processOriginMapObject(obj, path, tags) {
  if (!obj || typeof obj !== 'object') return

  // Skip Schema_UUID and Instance_UUID as they're handled separately
  for (const key in obj) {
    if (key === 'Schema_UUID' || key === 'Instance_UUID') continue

    const value = obj[key]
    const newPath = path ? `${path}/${key}` : key

    if (value && typeof value === 'object') {
      // Check if this is a metric (has Sparkplug_Type)
      if (value.Sparkplug_Type) {
        // This is a metric, add it to tags
        const tag = {
          Name: newPath,
          type: value.Sparkplug_Type,
          method: value.Method || 'GET',
          recordToDB: value.Record_To_Historian || false
        }

        // Add optional properties if they exist
        if (value.Address) tag.address = value.Address
        if (value.Path) tag.path = value.Path
        if (value.Value !== undefined) tag.value = value.Value
        if (value.Eng_Unit) tag.engUnit = value.Eng_Unit
        if (value.Eng_Low !== undefined) tag.engLow = value.Eng_Low
        if (value.Eng_High !== undefined) tag.engHigh = value.Eng_High
        if (value.Deadband !== undefined) tag.deadBand = value.Deadband
        if (value.Tooltip) tag.tooltip = value.Tooltip
        if (value.Documentation) tag.docs = value.Documentation

        tags.push(tag)

        // Add Schema_UUID for this value if it exists
        if (value.Schema_UUID) {
          tags.push({
            Name: `${newPath}/Schema_UUID`,
            type: 'UUID',
            method: 'GET',
            value: value.Schema_UUID,
            docs: 'A reference to the schema used for this object.',
            recordToDB: true
          })
        }
      } else {
        // This is an object, process it recursively
        processOriginMapObject(value, newPath, tags)
      }
    }
  }
}

/**
 * Updates the Edge Agent Deployment configuration for a node to include external drivers
 *
 * @param {string} nodeUuid - UUID of the node
 * @param {Array} connections - Array of connection objects from the connection store
 * @param {Array} deviceConnections - Array of device connection configurations from the Edge Agent config
 * @returns {Promise<void>}
 */
async function updateEdgeAgentDeployment(nodeUuid, connections, deviceConnections) {
  // Get the stores
  const driverStore = useDriverStore()
  const serviceClientStore = useServiceClientStore()
  const serviceClient = serviceClientStore.client

  // The driver store should already be refreshed by the parent function, but let's make sure
  if (!driverStore.ready) {
    console.debug('Driver store not ready, waiting...')
    await storeReady(driverStore)
  }
  try {

    // Get the current Edge Agent Deployment configuration
    /* XXX bmz: This is incorrect. If we are generating this then we
     * should do so from our source information and not look at what's
     * there already. */
    const [deployment, etag] = await serviceClient.ConfigDB.get_config_with_etag(UUIDs.App.EdgeAgentDeployment, nodeUuid) || [{}, null]

    if (!deployment) {
      console.error('Edge Agent Deployment configuration not found for node:', nodeUuid)
      return
    }

    // Initialize the values.drivers object if it doesn't exist
    if (!deployment.values) {
      deployment.values = {}
    }
    if (!deployment.values.drivers) {
      deployment.values.drivers = {}
    }

    // Create a map of connection names to driver image references
    const driverMap = {}

    console.debug('Updating edge agent deployment for node:', nodeUuid)
    console.debug('Connections:', connections)
    console.debug('Device connections:', deviceConnections)

    // Process each device connection to find external drivers
    for (const deviceConn of deviceConnections) {
      // Find the corresponding connection in the connection store
      console.debug('Looking for connection matching device connection:', deviceConn.name, 'with uuid:', deviceConn.uuid)

      // The s-s migration will have given every deviceConnections a uuid
      const connection = connections.find(conn => conn.uuid == deviceConn.uuid)
      if (!connection) {
        console.debug('No matching connection found for device connection:', deviceConn.name);
        continue;
      }
      console.debug('Found matching connection:', connection.name)

      // Check if driver is a UUID that points to a driver definition
      const driverUuid = connection.configuration?.driver;
      if (!driverUuid) {
        console.debug('No driver for connection:', deviceConn.name);
        continue;
      }
      console.debug('Found driver UUID:', driverUuid);

      // Look up the driver definition in the driver store
      const driverDef = driverStore.data.find(d => d.uuid === driverUuid);
      const image = driverDef?.definition?.image;
      if (!image) {
        console.debug('Driver definition not found in driver store or missing image');
        console.debug('Driver definition', driverDef);
        continue;
      }
      console.debug('Found driver image from driver store', image);

      driverMap[deviceConn.name] = {
        ...(connection.deployment ?? {}),
        image,
      };
    }

    /* XXX bmz: Here we need a source for EA-level values. */

    // Update the deployment configuration with the driver map
    console.debug('Final driver map:', driverMap)
    deployment.values.drivers = driverMap

    // Log the final deployment configuration
    console.debug('Final deployment configuration:', JSON.stringify(deployment, null, 2))

    // Update the Edge Agent Deployment configuration in the ConfigDB
    await serviceClient.ConfigDB.put_config(UUIDs.App.EdgeAgentDeployment, nodeUuid, deployment)
  } catch (error) {
    console.error('Error updating Edge Agent Deployment configuration:', error)
    // Don't fail the whole operation if this part fails
  }
}

/**
 * Updates the Edge Agent configuration for a device when its connection changes
 * or when its origin map is updated.
 *
 * @param {Object} options - Configuration options
 * @param {string} options.deviceId - UUID of the device (required if connectionId not provided)
 * @param {string} options.connectionId - UUID of the connection (required if deviceId not provided)
 * @returns {Promise<void>}
 */
export async function updateEdgeAgentConfig({
  deviceId = null,
  connectionId = null
}) {
  // Get the stores
  const deviceStore = useDeviceStore()
  const connectionStore = useConnectionStore()
  const driverStore = useDriverStore()
  const serviceClientStore = useServiceClientStore()
  const serviceClient = serviceClientStore.client

  // Make sure at least one of deviceId or connectionId is provided
  if (!deviceId && !connectionId) {
    console.error('Either deviceId or connectionId must be provided')
    return
  }

  // Refresh all stores to ensure we have the latest data
  console.debug('Refreshing stores before updating edge agent config')

  // Stop and restart all stores
  deviceStore.stop()
  connectionStore.stop()
  driverStore.stop()

  deviceStore.start()
  connectionStore.start()
  driverStore.start()

  // Wait for all stores to be ready
  await Promise.all([
    storeReady(deviceStore),
    storeReady(connectionStore),
    storeReady(driverStore)
  ])

  console.debug('All stores refreshed')
  try {
    // If we have a connectionId, get all devices using this connection
    // If we have a deviceId, just get that device
    let devices = []
    let connections = []

    if (connectionId) {
      // Get the connection directly from ConfigDB to ensure we have the latest data
      try {
        // Get the connection info
        const connectionInfo = await serviceClient.ConfigDB.get_config(UUIDs.App.Info, connectionId) || {}
        // Get the connection configuration
        const connectionConfig = await serviceClient.ConfigDB.get_config(UUIDs.App.ConnectionConfiguration, connectionId) || {}

        if (!connectionInfo || !connectionConfig) {
          console.error('Connection not found in ConfigDB:', connectionId)
          return
        }

        // Create a complete connection object with the latest data
        const connection = {
          uuid: connectionId,
          /* XXX bmz: This should not be the GI name, that is for human
           * consumption. Either (1) we should generate names, (2) we need a
           * `name` prop in the Connection Config entry or (3) we need
           * an _Edge Agent request_ entry with map from names to
           * connection UUIDs, and maybe also from names to Devices. */
          name: connectionInfo.name,
          configuration: connectionConfig
        }

        console.debug('Fetched latest connection data from ConfigDB:', connection)
        connections.push(connection)

        // Find all devices using this connection
        devices = deviceStore.data.filter(d => d.deviceInformation?.connection === connectionId)
      } catch (error) {
        console.error('Error fetching connection from ConfigDB:', error)
        return
      }
    } else {
      // Get the device
      const device = deviceStore.data.find(d => d.uuid === deviceId)

      if (!device) {
        console.error('Device not found:', deviceId)
        return
      }
      devices.push(device)

      // Get the connection for this device
      if (device.deviceInformation?.connection) {
        try {
          // Get the connection info
          const connectionId = device.deviceInformation.connection
          const connectionInfo = await serviceClient.ConfigDB.get_config(UUIDs.App.Info, connectionId) || {}
          // Get the connection configuration
          const connectionConfig = await serviceClient.ConfigDB.get_config(UUIDs.App.ConnectionConfiguration, connectionId) || {}

          if (connectionInfo && connectionConfig) {
            // Create a complete connection object with the latest data
            const connection = {
              uuid: connectionId,
              name: connectionInfo.name,
              configuration: connectionConfig
            }

            console.debug('Fetched latest connection data from ConfigDB:', connection)
            connections.push(connection)
          }
        } catch (error) {
          console.error('Error fetching connection from ConfigDB:', error)
        }
      }
    }

    console.debug('Devices:', devices)
    console.debug('Connections:', connections)

    // If we don't have any devices or connections, return
    if (devices.length === 0 || connections.length === 0) {
      console.error('No devices or connections found')
      return
    }

    /* XXX bmz: The structure here is inside-out. We have a complete
     * list of origin maps and connection configs; we can generate the
     * EA configs completely from these. We should not be using the
     * existing config at all, instead we should just rebuild the whole
     * thing from scratch using the information we have. This would
     * avoid all the fragile logic searching for matching parts of the
     * existing config and would ensure that configs are properly
     * updated when the code here changes.
     *
     * Also: this should not be in the frontend. The frontend should
     * just update the source entries and then a backend service should
     * pick those changes up and generate the Edge Agent configs.
     */

    // Get the node UUID from the first device
    const nodeUuid = devices[0].deviceInformation?.node
    if (!nodeUuid) {
      console.error('Node UUID not found for device')
      return
    }

    // Get the current edge agent config
    const [edgeAgentConfig, etag] = await serviceClient.ConfigDB.get_config_with_etag(UUIDs.App.EdgeAgentConfig, nodeUuid) || [{}, null]

    // Create a new config if none exists
    const config = edgeAgentConfig || {
      '$schema': 'https://raw.githubusercontent.com/AMRC-FactoryPlus/schemas/main/Edge_Agent_Config.json',
      'sparkplug': {
        'asyncPubMode': true
      },
      'deviceConnections': []
    }

    // Process each connection
    for (const connection of connections) {
      const connectionConfiguration = connection?.configuration
      if (!connectionConfiguration) continue

      console.debug('Processing connection:', connection.name)
      console.debug('Connection configuration:', connectionConfiguration)

      // Find if this connection already exists in the config
      const connType = connectionConfiguration.driver?.internal?.connType || 'Driver'
      const connDetailsKey = connectionConfiguration.driver?.internal?.details || 'DriverDetails'
      const connDetails = connectionConfiguration.config

      // Find the connection in the config
      let connectionIndex = -1
      let connectionConfig = null

      // We can search by UUID; service-setup will have updated all EA
      // configs to have this uuid property.
      if (config.deviceConnections) {
        connectionIndex = config.deviceConnections.findIndex(conn => 
          conn.uuid == connection.uuid);
      }

      if (connectionIndex >= 0) {
        console.debug('Found existing connection in edge agent config at index:', connectionIndex)
        connectionConfig = config.deviceConnections[connectionIndex]
        // Update the pollInt for existing connections
        if (connectionConfiguration.pollInt) {
          console.debug('Updating pollInt from', connectionConfig.pollInt, 'to', connectionConfiguration.pollInt)
          connectionConfig.pollInt = connectionConfiguration.pollInt
        }
        // Update the payloadFormat for existing connections
        if (connectionConfiguration.source?.payloadFormat) {
          console.debug('Updating payloadFormat from', connectionConfig.payloadFormat, 'to', connectionConfiguration.source.payloadFormat)
          connectionConfig.payloadFormat = connectionConfiguration.source.payloadFormat
        }
      }

      // If connection doesn't exist, create it
      if (connectionIndex < 0) {
        connectionConfig = {
          uuid: connection.uuid,
          name: connection.name || 'Connection',
          connType: connType,
          pollInt: connectionConfiguration.pollInt || 1000,
          devices: []
        }

        // Add the connection details with the appropriate key
        if (connDetails) {
          connectionConfig[connDetailsKey || 'DriverDetails'] = connDetails
        }

        // Add payloadFormat if it exists
        if (connectionConfiguration.source?.payloadFormat) {
          connectionConfig.payloadFormat = connectionConfiguration.source.payloadFormat
        }

        // Add the new connection to the config
        if (!config.deviceConnections) {
          config.deviceConnections = []
        }
        config.deviceConnections.push(connectionConfig)
        connectionIndex = config.deviceConnections.length - 1
      }

      // Process each device for this connection
      const devicesForThisConnection = devices.filter(d => d.deviceInformation?.connection === connection.uuid)

      for (const device of devicesForThisConnection) {
        // Find if this device already exists in the connection
        const deviceIdValue = device.name

        let deviceIndex = -1

        if (connectionConfig.devices) {
          // First, check if this device exists in any other connection and remove it
          for (let i = 0; i < config.deviceConnections.length; i++) {
            if (i !== connectionIndex && config.deviceConnections[i].devices) {
              const oldDeviceIndex = config.deviceConnections[i].devices.findIndex(dev => dev.deviceId === deviceIdValue)
              if (oldDeviceIndex >= 0) {
                // Remove the device from the old connection
                config.deviceConnections[i].devices.splice(oldDeviceIndex, 1)
              }
            }
          }

          // Now check if the device exists in the current connection
          deviceIndex = connectionConfig.devices.findIndex(dev => dev.deviceId === deviceIdValue)
        }

        // Get the device's origin map
        const deviceOriginMap = device.deviceInformation.originMap

        // Create tags from the origin map if provided
        let tags = []

        // If the device has an origin map, create tags from it
        if (deviceOriginMap) {
          // Create tags from the origin map
          tags = createTagsFromOriginMap(deviceOriginMap)
        }
        // If the device has an existing configuration, preserve its tags
        else if (deviceIndex >= 0 && connectionConfig.devices[deviceIndex].tags) {
          // Preserve existing tags
          tags = connectionConfig.devices[deviceIndex].tags
        }
        // Fallback to a basic tag with schema UUID if available
        else if (device.deviceInformation.schema) {
          // Create a basic tag with the schema UUID
          tags = [{
            Name: 'Schema_UUID',
            type: 'UUID',
            method: 'GET',
            value: device.deviceInformation.schema,
            docs: 'A reference to the schema used for this object.',
            recordToDB: true
          }]
        }

        // Create or update the device in the connection
        const deviceConfig = {
          deviceId: deviceIdValue,
          deviceType: deviceOriginMap?.Schema_UUID || device.deviceInformation.schema,
          templates: [],
          tags: tags,
          pubInterval: device.pub_interval || 0,
          payloadFormat: connectionConfiguration.source?.payloadFormat || 'Defined by Protocol'
        }

        if (deviceIndex >= 0) {
          // Update existing device
          connectionConfig.devices[deviceIndex] = deviceConfig
        } else {
          // Add new device
          if (!connectionConfig.devices) {
            connectionConfig.devices = []
          }
          connectionConfig.devices.push(deviceConfig)
        }
      }
    }

    // Clean up any connections that no longer have devices
    if (config.deviceConnections) {
      // Filter out connections with no devices
      config.deviceConnections = config.deviceConnections.filter(conn => {
        return conn.devices && conn.devices.length > 0
      })
    }

    // Log the final config before saving
    console.debug('Final edge agent config to be saved:', JSON.stringify(config, null, 2))

    // Update the edge agent config in the ConfigDB
    await serviceClient.ConfigDB.put_config(UUIDs.App.EdgeAgentConfig, nodeUuid, config)

    // Update the Edge Agent Deployment configuration for external drivers
    await updateEdgeAgentDeployment(nodeUuid, connections, config.deviceConnections)
  } catch (configErr) {
    console.error('Error updating edge agent config:', configErr)
  }
}
