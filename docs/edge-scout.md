# Edge Agent Scout Mode (Draft)

## Objective
The Edge Agent receives a configuration containing manually set addresses for data sources, which are defined in the ACS Config Service and then sent to the Edge Agent to retrieve data.

The challenge with this approach is that addresses must be known in advance, typically provided by manufacturers for each device. However, these addresses may be incorrect or vary between devices.

The scouting feature reverses this manual process. Instead of predefining addresses, the Edge Agent, when run in scout mode, requests devices to provide their actual list of available addresses. This functionality is implemented for each communication protocol that supports address discovery, such as OPC UA, MQTT, and others.

The discovered addresses are then stored in the ACS Config Service under the Scout application, mapped to each device connection.

![High Level Diagram](./assets/edge-agent-scout/acs-edge-scout-high-level-diagram.png?raw=true)

## Edge Agent Configuration (ACS Config Service)
The ACS Config Service stores the **Edge Agent** configuration with all connections created in the ACS Manager and migrated into the ACS Config Service.

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
The Edge Scout Results Application (UUID **f8c1b13b-ebaf-45c9-b712-9cd712695513**) was created in ACS Config Service to store discovered addresses. It consists of configurations identified by UUIDs, each corresponding to a device connection.

Once scouting is performed, the discovered addresses are stored in the `addresses` property as **key-value pairs**, where
- The **keys** in addresses section always represent the actual addresses.
- The **values** are objects containing additional information, with the format varying based on protocol and available data.

These configurations are mapped to their respective **device connections** using the **UUID** of each connection ([See `uuid` property of `deviceConnection` in Edge Agent Configuration](#example-partial-edge-agent-configuration-yaml-file-showing-only-scouting-related-entries)).

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
      "namespaceURI": "http://opcfoundation.org/UA/",
      "dataType": "String"
    },
    "ns=0;i=2255": {
      "name": "NamespaceArray",
      "nodeClassID": 2,
      "nodeClassName": "Variable",
      "namespace": 0,
      "namespaceURI": "http://opcfoundation.org/UA/",
      "dataType": "String"
    },
    "ns=0;i=2256": {
      "name": "ServerStatus",
      "nodeClassID": 2,
      "nodeClassName": "Variable",
      "namespace": 0,
      "namespaceURI": "http://opcfoundation.org/UA/",
      "dataType": "ServerStatusDataType"
    },
  },
  "timestamp": 1741375743932,
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
  "timestamp": 1741375743934,
  "success":true
}
```

## Implementation
### DeviceConnection abstract class (Changes for Scouting Feature)
A new method is added to the abstract **DeviceConnection** class:
```
public async scoutAddresses(driverDetails: ScoutDriverDetails): Promise<object>
```
- This method **must be implemented** in its subclasses (MQTTConnection, OPCUAConnection, etc.), as the process for retrieving available addresses differs based on the protocol.
- It accepts `driverDetails` part of the scout configuration.
- It returns the scouting results as an `object`.


### MQTTConnection (Changes for Scouting Feature)
MQTTConnection implements the the `scoutAddresses` method of its superclass, [DeviceConnection](#deviceconnection-abstract-class-changes-for-scouting-feature).


```
interface MqttScoutDetails extends ScoutDriverDetails {
    duration: number,
    topic: string
}

async validateConfigDetails(driverDetails: any): Promise<MqttScoutDetails>{
  ...
}

public async scoutAddresses(driverDetails: ScoutDriverDetails): Promise<object>{
  ...
}
```
- This method receives `driverDetails` part of the scout configuration and passes it to the `validateConfigDetails(driverDetails: any): Promise<MqttScoutDetails>` method for validation.
- It then receives the validated and formatted `MqttScoutDetails`.
- It creates a new MQTT client and connects to the provided MQTT broker.
- It's client listens to the `driverDetails.topic` for the specified `driverDetails.duration`.
- Once the duration passes, it closes the MQTT connection.
- Finally, it returns the object where MQTT topics are stored as keys within `addresses` entry.


### OPCUAConnection (Changes for Scouting Feature)

The **OPC UA** protocol can handle address discovery natively and does not require manual configuration, therefore the `driverDetails` for OPC UA connections are empty.
The `OPCUAConnection` subclass implements the `public async scoutAddresses(driverDetails: ScoutDriverDetails): Promise<object>` from its superclass `DeviceConnection`.

```
public async scoutAddresses(driverDetails: ScoutDriverDetails): Promise<object>{
  ...
}
```
- This method creates a new OPC UA client and connects to the provided OPC UA server.
- It browses through all nodes and namespaces starting from the root folder, recursively checking all child nodes.
- It skips metadata or structural nodes that does not represent actual values. Those nodes belong to following node classes of [4, 8, 16, 32, 64] where:
  - 0 is Unspecified
  - 1 is Object
  - 2 is Variable
  - 4 is Method
  - 8 is ObjectType
  - 16 is VariableType
  - 32 is ReferenceType
  - 64 is DataType
  - 128 is View
- It saves the rest of the nodes as discovered addresses.
- It closes the OPC UA connection once the browsing is complete.
- Finally, it returns the object where OPC UA node addresses are stored as keys and additional node metadata is stored as value objects within `addresses` entry.


### Scout Class (New Component)
```
export interface ScoutDetails {
    isEnabled: boolean
}

export interface ScoutResult {
    addresses: object | null,
    timestamp: number | null,
    success: boolean
}

export class Scout extends EventEmitter {
    constructor(deviceConnection: DeviceConnection, scoutFullConfig: any) {
        super();
        this.deviceConnection = deviceConnection;
        this.scoutDetails = this.validateScoutConfig(scoutFullConfig.scoutDetails);
        this.driverDetails = scoutFullConfig.driverDetails;
    }


    public async performScouting(): Promise<void> {
      ...
    }

    private validateScoutConfig(scoutDetails: any): ScoutDetails {
      ...
    }
}
```

- The Scout class receives the `DeviceConnection` instance `deviceConnection` and a full scout configuration `scoutFullConfig` through its `constructor`.
- The `constructor` splits the scout configuration into `scoutDetails` and `driverDetails`.
- The `scoutDetails` part is validated in the `validateScoutConfig` method against the `ScoutDetails` type.
- The `performScouting` method, when called, checks whether the `scoutDetails.isEnabled` is set to `true`. If the `isEnabled` is `true`, the method calls the `scoutAddresses(driverDetails)` on `deviceConnection` and passes the `driverDetails` part of the scout configuration. The validation for `driverDetails` is handled by each `DeviceConnection` subclass depending on the protocol.
- Once the `scoutAddresses` method returns the list of `addresses`, the `performScouting()` method creates a `scoutResult` object of type `ScoutResult`, containing the discovered `addresses`, `timestamp` and a `success` status.
- Finally, the `performScouting()` method triggers the **scoutResults** event with the `scoutResult`.

### Translator Class (Changes for Scouting Feature)
The `async setupConnection(connection: any): Promise<void>` method of the `Translator` class was modified to instantiate a `Scout` class alongside each device connection when it is created. The method checks whether `scoutDetails.isEnabled` is set to `true`. If so, it runs the `DeviceConnection` in scout mode by instantiating the `Scout` class and passing the `DeviceConnection` instance to it. Otherwise, it runs the `DeviceConnection` in default mode, as per the standard Edge Agent functionality.

Upon creating the `Scout` instance (`newScout`), the `Translator` subscribes to the `scoutResults` event, which returns the `scoutResult`. When the `scoutResults` event is triggered, the `success` status of `scoutResult` is checked. If `success` is true, the `scoutResult` is sent to the ACS Config Service to be stored in the **Edge Scout Results** application under the corresponding device connection. This is achieved by calling the ConfigDB API `put_config(app, obj, json)`, where the provided parameters are:
- `app` - UUID for the Edge Scout Results application
- `obj` - UUID for the Device Connection
- `json` - Content in JSON format


Finally, after creating `newScout` and subscribing to its `scoutResults` event, the `Translator` calls the `performScouting()` method on `newScout`.
```
async setupConnection(connection: any): Promise<void> {
  ...
  const newConn = new deviceInfo.connection(
      connection.connType,
      connection[deviceInfo.connectionDetails],
      connection.name,
      this.broker);

  if (connection.scout?.scoutDetails?.isEnabled) {
      const newScout = new Scout(newConn, connection.scout);
      newScout.on('scoutResults', async (scoutResult: ScoutResult) => {
        if(scoutResult.success){
          await this.put_to_config(UUIDs.App.EdgeScoutResults, connection.uuid, JSON.stringify(scoutResult));
        }
      });
      newScout.performScouting();
  }
  ...
}
```
