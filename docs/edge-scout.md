# Edge Agent Scout Mode (Draft)

## Objective
Currently, the Edge Agent receives a configuration containing manually set addresses for data sources, which are defined in the ACS config service and then sent to the Edge Agent to retrieve data.

The challenge with this approach is that the addresses must be known in advance, typically provided by manufacturers per device. However, these addresses can be incorrect or vary between devices.

The goal of this new feature is to develop an MVP to explore whether this manual process can be reversed. Instead of predefining addresses, the Edge Agent would run in scout mode, actively requesting devices to provide their actual list of available addresses. This functionality would need to be implemented for each supported communication protocol, such as OPC UA, MQTT, and others.
Once the Edge Agent receives the list of data sources from the devices, it should store this information in the ACS config service.


## Architecture
This feature will be implemented by extending the existing Edge Agent source code. The configuration sent from the ACS Config Service will be modified to include an entry specifying whether the Edge Agent should run in Scout mode.

If Scout mode is enabled, the Edge Agent will trigger the scouting method for each supported connection type (OPC UA, MQTT, etc.). Once the list of addresses is received, the Edge Agent will send it to the ACS Config Service to be stored within a new object.

![High Level Diagram](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack/blob/za/edge_agent_scout_mode/docs/assets/edge-agent-scout/acs-edge-scout-high-level-diagram.png?raw=true)

## Implementation

