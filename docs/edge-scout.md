# Edge Agent Scout Mode (Draft)

## Objective
Currently, the Edge Agent receives a configuration containing manually set addresses for data sources, which are defined in the ACS config service and then sent to the Edge Agent to retrieve data.

The challenge with this approach is that the addresses must be known in advance, typically provided by manufacturers per device. However, these addresses can be incorrect or vary between devices.

The goal of this new feature is to develop an MVP to explore whether this manual process can be reversed. Instead of predefining addresses, the Edge Agent would run in scout mode, actively requesting devices to provide their actual list of available addresses. This functionality would need to be implemented for each supported communication protocol, such as OPC UA, MQTT, and others.
Once the Edge Agent receives the list of data sources from the devices, it should store this information in the ACS config service.


## Architecture
This feature will extend the existing Edge Agent source code. The ACS Config Service configuration will be updated to specify whether the Edge Agent should run in Scout mode and may include additional connection-specific configurations if needed.

If Scout mode is enabled, the Edge Agent will trigger the scouting method for each supported connection type (OPC UA, MQTT, etc.). Once the list of addresses is received, the Edge Agent will send it to the ACS Config Service to be stored within a new object.

![High Level Diagram](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack/blob/za/edge_agent_scout_mode/docs/assets/edge-agent-scout/acs-edge-scout-high-level-diagram.png?raw=true)

## Implementation
### Translator Class (Changes for Scouting Feature)
The scouting feature is embedded into the Edge Agent's Translator class.
- The Translator class checks if the connection configuration includes a scout entry.
- If the current connection is configured to run in scout mode, the Translator creates an instance of the Scout class for this connection, passing the DeviceConnection instance and scoutConfig as arguments to the constructor:
`constructor(deviceConnection: DeviceConnection, scoutConfig: any)`
- Upon creating the Scout instance, the Translator subscribes to the **scoutComplete** event, which returns a list of discovered addresses. The Translator then sends this list back to the ACS Config Service.
- Finally, the Translator calls the Scout instance's `performScouting()` method to perform scouting.
  
### Scout Class (New Component)
- The Scout class receives the DeviceConnection instance and scoutConfig.
- The Scout class understands the expected configuration format for each type of DeviceConnection and converts it accordingly (e.g., MQTT, OPC UA, etc.).
- The `performScouting()` method invokes the relevant method of the DeviceConnection to perform scouting.
- Once the DeviceConnection completes scouting, `performScouting()` receives a list of discovered addresses.
- Finally, the method triggers the **scoutComplete** event with the list of discovered addresses.

### DeviceConnection (Changes for Scouting Feature)
- A new method is added to the abstract DeviceConnection class:
`public async scoutAddresses(scoutDetails: ScoutDetails): Promise<string[]>`
- This method must be implemented in its subclasses (MQTTConnection, OPCUAConnection), as the process for retrieving available addresses varies based on the protocol.

### MQTTConnection (Changes for Scouting Feature)
MQTTConnection implements the `public async scoutAddresses(scoutDetails: ScoutDetails): Promise<string[]>` of its superclass DeviceConnection. 
- The `scoutAddresses` method for MQTTConnection retrieves the topic and duration from its configuration.
These parameters define:
  - Topic: The topic to listen to (e.g., #).
  - Duration: The length of time to listen (e.g., 5 minutes).

- The MQTTConnection creates a dedicated MQTT client for scouting, which:
    - Subscribes to the specified topic.
    - Listens for the given duration.
    - Collects all topics received during this period.
    - Returns the list of discovered topics to the Scout class.
    - Shuts down the MQTT client after scouting is complete.
  
### OPCUAConnection (Changes for Scouting Feature)
OPCUAConnection implements the `public async scoutAddresses(scoutDetails: ScoutDetails): Promise<string[]>` of its superclass DeviceConnection.
- The OPCUAConnection creates an OPC UA client and a session that recursively searches for all nodes within the provided OPCUA server starting from the RootNode.
- Certain Node Classes can contain child nodes, so their children are also checked. These classes include:
    - Object (1)
    - ObjectType (8)
    - ReferenceType (32)

- If a node belongs to a leaf node class, it is not further traversed. Leaf node classes include:
    - Variable (2)
    - VariableType (16)
    - Method (4)
    - DataType (64)
    - View (128)

- Nodes of the Variable class (2) are stored in a list of unique values and returned to the Scout class.