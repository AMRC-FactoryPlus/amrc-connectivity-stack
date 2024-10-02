# ACS Reconciliation service

This service is responsible for arranging for dynamic data collection.
The service reads ConfigDB entries to find out what data is available,
and uses the Rendezvous service to find out which consumers want data.
Then it uses this information to deploy Edge Agents collecting the
desired data and informs the consumers (via the Rendezvous service)
where their data can be found.

## Data available for consumption

Previously the assumption within Factory+ has been that the edge
configuration, specifying the devices available external to F+ and the
data which can be collected from them, belongs to the Edge Agent. The
Manager provides an interface to edit the Edge Agent configuration but
the focus is still on setting up a single Edge Agent at a time.

The proposal here is to change this. Instead of the Manager being used
to create permanent Edge Agent config files, it will be used to create
the following objects:

* _Connection configs,_ which define available connections to devices
  and systems external to F+ from which data can be collected.
* _Instance configs,_ which define the metrics available from a given
  connection and attach semantics to the data.

These are the existing objects already present in the Edge Agent
configuration, however they are now entered into the ConfigDB as objects
in their own right. This means we can define the data available from a
connection, which is a step which must (currently) be performed manually
as we are introducing semantic information, without yet having deployed
an Edge Agent to collect that data.

### Connection configs

A Connection Config specfies an available connection to an external
device, for example an OPC-UA server. This will include the driver
required to communicate with the device and the configuration for that
driver: hostnames, authentication and so on. This is the information
currently held in the Edge Agent DeviceConnection structure.

A 'floating' Connection Config will also need information about network
topology, which previously was implicit in the deployment of the Edge
Agent. This might be a restriction to a specific host, for connections
which are point-to-point or require specific hardware; it might be a
more general restriction to a particular cluster; or there might be no
restriction at all. (The last case is perhaps not very likely. Even
where a system is generally accessible control over where it is accessed
from is probably desirable.)

Something that will need considering here is how to store authentication
information securely. The current system transports this information to
the edge cluster securely but has (by design) no way to retrieve it.
Moving a Connection across clusters would either require keeping this
information centrally, which is less secure, or would require
re-entering credentials or creating new credentials when a Connection
moved.

### Instance configs

These are the existing schema instance configs the Manager already
creates. As now they are tied to a particular connection, which provides
context for the Metric Address fields. As now they exist to document the
data available from the connection and to attach semantic information to
it.

One advantage of creating these directly in the ConfigDB is that all
schema instance UUIDs will automatically be registered. This makes it
possible to attach ACLs and other ConfigDB information to a schema
instance independently of any particular Device which might be
publishing it.
