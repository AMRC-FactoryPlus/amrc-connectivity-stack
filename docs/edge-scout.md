# Edge Agent Scout Mode (Draft)

## Objective
The Edge Agent receives a configuration containing manually set addresses for data sources, which are defined in the ACS Config Service and then sent to the Edge Agent to retrieve data.

The challenge with this approach is that addresses must be known in advance, typically provided by manufacturers for each device. However, these addresses may be incorrect or vary between devices.

The scouting feature reverses this manual process. Instead of predefining addresses, the Edge Agent, when run in scout mode, requests devices to provide their actual list of available addresses. This functionality is implemented for each communication protocol that supports address discovery, such as OPC UA, MQTT, and others.

The discovered addresses are then stored in the ACS Config Service under the Scout application, mapped to each device connection.

![High Level Diagram](./assets/edge-agent-scout/acs-edge-scout-high-level-diagram.png?raw=true)

## Edge Agent Configuration (ACS Config Service)
The ACS Config Service stores the **Edge Agent** configuration for all connections created in the ACS Manager and migrated into the ACS Config Service.

Each configuration includes a list of device connections (`deviceConnections`) managed in the ACS Manager. These configurations contain connection details such as the connection type, connection UUID, necessary scouting entries, and other details that are not relevant to the scouting feature.

The **scout** entry consists of two main parts: **scoutDetails** and **driverDetails**.
- **scoutDetails**: This part is standard across all device connections. The boolean property **isEnabled** specifies whether Edge Agent should run in scouting mode, allowing to request addresses from devices associated with that deviceConnection. 
- **driverDetails**: This part is protocol-specific. Ideally, scouting should not rely on predefined configurations and should retrieve all addresses automatically. However, if a protocol does not natively support address discovery, manual configuaration may be required.  
  - MQTT driverDetails: Specifies **topic** and **duration**. The Edge Agent listens for messages within the specified **topic** for the given **duration** and returns any discovered addresses. 
  - driverDetails for OPC UA: 

#### Example: Partial Edge Agent configuration YAML file showing only scouting-related entries
```
deviceConnections:
    - OPCUAConnDetails:
        connType: OPC UA
        name: OPC_UA_Connection
        uuid: 05e11cd5-07d2-4a37-88c9-fb74b3f4638f
        scout:
          scoutDetails:
            isEnabled: true
          driverDetails:
      
    - MQTTConnDetails:
        connType: MQTT
        name: MQTT_Connection
        uuid: 2107c3d2-3b92-455c-8401-ff717f4e4a10
        scout:
          scoutDetails:
            isEnabled: true
          driverDetails:
            topic: '#'
            duration: 10000
```
## Edge Scout Results Application (ACS Config Service)
The Edge Scout Results application consists of configurations identified by UUIDs, each corresponding to a device connection. Once scouting is performed, the discovered addresses are stored within addresses property as key-value pairs, where the key is the address and the value is an object containing additional information. The format of this object varies depending on the type of data available for the protocol. These configurations are mapped to their respective device connections by the device connection's **uuid** ([See `uuid` property of deviceConnection in Edge Agent Configuration](#example-partial-edge-agent-configuration-yaml-file-showing-only-scouting-related-entries)).


The scouting results are stored as key-value objects in JSON format, mapped to their device connections within the Edge Scout Results application (UUID **f8c1b13b-ebaf-45c9-b712-9cd712695513**). 
- The keys in addresses section always represent the actual addresses.
- The values are objects containing additional information if provided by the protocol.
- The format of tje value varies depending on the protocol.

#### Example: Discovered addresses stored in ACS Config Service
 **f8c1b13b-ebaf-45c9-b712-9cd712695513** - UUID for Edge Scout Results Application
- **2b047ab0-b7b3-4bf3-a2d4-f98059c424f0** - UUID for OPC UA Device Connection
```
{
  "addresses": {
    "ns=0;i=2254": {
      "name": "ServerArray",
      "nodeClassID": 2,
      "nodeClassName": "Variable",
      "namespace": 0,
      "namespaceURI": "http://opcfoundation.org/UA/"
    },
    "ns=0;i=2255": {
      "name": "NamespaceArray",
      "nodeClassID": 2,
      "nodeClassName": "Variable",
      "namespace": 0,
      "namespaceURI": "http://opcfoundation.org/UA/"
    },
    "ns=0;i=2256": {
      "name": "ServerStatus",
      "nodeClassID": 2,
      "nodeClassName": "Variable",
      "namespace": 0,
      "namespaceURI": "http://opcfoundation.org/UA/"
    },
  },
  "success": true
}
```
- **1ef0e3aa-bc6d-4ff0-af94-972772ac8126** - UUID for MQTT Device Connection

```
{
  "addresses": {
    "AMRC/F2050/PowerMonitoring/amrc-tplink-02/Status":{},
    "AMRC/F2050/PowerMonitoring/amrc-tplink-46/Status":{},
    "AMRC/F2050/PowerMonitoring/amrc-tplink-112/Status":{},
  },
  "success":true
}
```


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

`new NodeId(scoutDetails.NodeIdType, scoutDetails.Identifier, scoutDetails.NamespaceIndex);`

`async browseOPCUANodes(session, nodeId: NodeId): Promise<ReferenceDescription[]>`
```
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
```

# OPCUA doc from NodeOPCUA reference doc
## Enumeration NodeIdType
`NodeIdType` is an enumeration that specifies the possible types of a `NodeId` value.
Enumeration members:
- BYTESTRING
- GUID
- NUMERIC
- STRING


## 