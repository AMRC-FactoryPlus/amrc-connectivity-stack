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
the following types of object:

* _Connection config,_ which defines an available connection to a device
  or system external to F+ from which data can be collected.
* _Instance config,_ which defines (some of) the metrics available from
  a given connection and attaches semantics to the data.

These are the existing objects already present in the Edge Agent
configuration, however they are now entered into the ConfigDB as objects
in their own right. This means we can define the data available from a
connection, which is a step which must be performed manually as we are
introducing semantic information, without yet having deployed an Edge
Agent to collect that data.

### Connection configs

A _Connection config_ specfies an available connection to an external
device, for example an OPC-UA server. This will include the driver
required to communicate with the device and the configuration for that
driver: hostnames, authentication and so on. This is the information
currently held in the Edge Agent DeviceConnection structure, plus the
driver deployment information needed for the `edge-agent` Helm chart. If
we want to support additional deployments (rather than just driver
containers) this will need considering as well.

A 'floating' _Connection config_ will also need information about
network topology, which previously was implicit in the deployment of the
Edge Agent. This might be a restriction to a specific host, for
connections which are point-to-point or require specific hardware; it
might be a more general restriction to a particular cluster; or there
might be no restriction at all. (The last case is perhaps not very
likely. Even where a system is generally accessible control over where
it is accessed from is probably desirable.)

Since connections now exist as dedicated objects in the ConfigDB it is
possible for other parts of F+, such as Edge Agent Alerts, to refer to
them. A provisional structure for a _Connection config_ might be:

```yaml
driver: 132cb88a-9ada-41fa-803e-809f37186c1e
topology:
    cluster: 277c8c3a-bdc7-4b30-85b5-5247cf1eb3c3
    hostname: edge-host-1234
deployment: {}
config:
    endpoint: opc.tcp://192.168.1.1:4840
    securityMode: Node
    securityPolicy: Node
    useCredentials: false
source:
  payloadFormat: Buffer
  pollInterval: 1000
```

This information is used in the following ways:

* `driver` identifies the driver used for this connection. These will
  need to be registered in the ConfigDB and information provided about
  the container image to use.
* `topology` identifies the cluster and host from which this connection
  may be made. This is used to combine connections into Edge Agents and
  to build the _Edge deployment_ entry.
* `deployment` contains additional information passed in the Helm values
  in the _Edge deployment_ entry for this connection. This will be
  needed for things like providing access to host devices.
* `config` is the driver-specific config which is passed through into
  the _Edge Agent config_ and then passed down to the driver.
* `source` is the remaining information needed in the _Edge Agent
  config_ to be able to read from the connection.

### Driver definitions

The connection config definition above assumes the external driver work
on the Edge Agent has been carried through to completion, in particular:

* All drivers are implemented externally.
* Available drivers are registered in the ConfigDB.
* Information is available in the ConfigDB giving a schema for the
  driver config and details of the driver image.

The schema for the driver config will be needed by the Manager to build
a sensible UI for configuration. The driver image details will need to
be copied into the Helm values in the _Edge deployment_ config entry;
these will probably want to be overridable from the `deployment` key of
individual connections, for testing new container images.

The `edge-agent` Helm chart will need adjusting to make this work. In
particular, the driver image definitions will need moving around; the
logic to define a list of images which are then referenced is useful
when writing values files by hand, but much less so when generating
them. The default images will want removing altogether in favour of a
default set of drivers registered in the ConfigDB. The logic to expose
host devices to the container will also need changing; it should be
possible to collate the list of required host devices for the `volumes`
part of the Pod from a set of per-driver mappings.

If any drivers are still implemented internally in the Edge Agent these
will need special-casing somewhere. This can either be done by the
Reconcilation service (preferably under ConfigDB control) or the Edge
Agent can be changed to accept a new config file format.

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

The format of the configuration needs to change from the current flat
list of metrics associated with a Device. In the first place, the
sub-instances within this instance will need breaking out and
referencing. On top of that, it will be important to be able to easily
identify the schema applicable to this instance. We cannot use the
ConfigDB classes for this as they are not flexible enough to be used as
a general classification mechanism.

Explicit configuration of the 'metadata' metrics `Schema_UUID` and
`Instance_UUID` is unnecessary. It would also be better to consider
leaving static(ish) metadata such as descriptions and units in the
ConfigDB, without exporting them to the Edge Agent; ideally these would
be defaulted in the schema definition and potentially overridden in the
instance definition. However this would require changes to anything
which expects this data in Sparkplug (I'm not sure there is anything...)

A more important improvement, which would require Edge Agent changes,
would be to stop exposing the address/path information which ought to be
private to the Edge Agent. This could be combined with replacing the
`method` property with something to distiguish between static and
dynamic metrics. Perhaps `update: BDC` to show updates are possible in
Birth, Data and Cmd packets.

Something like this is likely to be needed:

```yaml
schema: d6de8765-bfbe-4f6b-b5d8-822dbd7f3a49
connection: 948a5669-fed9-4d8e-ac46-78fcf825ee38
metrics:
  Voltage:
    type: Double
    source:
      address: Meter
      path: $.voltage
      deadband: 0.1
    properties:
      update: BD
      engUnit: V
      engLow: 0
      engHigh: 320
instances:
  Characteristics: a30aee1e-e896-4ba2-930c-8da81dc8f897
```

Obviously validation will be needed, for example that metrics and
sub-instances don't overlap, and that all sub-instances are pulled from
the same connection. (Data pulled from different connections cannot be
exposed within a single Device, as we need to be able to signal
DBIRTH/DDEATH.) Including the connection information in every
sub-instance is strictly redundant, and could potentially be avoided if
we maintain an index of parent-child relationships, but this seems a
little risky given that addresses are only meaningful within the context
of the correct connection.

## Reconciliation

The reconciliation process has these steps:

* Identifying consumers via the Rendezvous service.
* Locating providers to suit from the ConfigDB.
* Creating ConfigDB entries to deploy and configure Edge Agents as
  appropriate.
* Setting up permissions so the consumers can access the data.
* Informing the consumers via the Rendezvous service.

### Identifying consumers

Consumers request data via the Rendezvous service. The reconciliation
service defined here will accept requests of type _Factory+ Schema_ 
which want responses of type _Sparkplug Instance_ .

The Rendezvous service provides change-notify, so the Reconcilation
service can watch for changes to requests.

Authorisation will be necessary at this point. The Reconciliation
service will necessarily have to trust the authentication carried out by
the Rendezvous service when identifying the principal involved.

### Locating providers

Given a consumer _Factory+ Schema_ request, locating the instances which
can satisfy it is a simple ConfigDB search. More sophisticated
reconcilation algorithms however might need more indexing than the
current ConfigDB can provide. The current spec knows nothing about
things like engineering units, leaving comprehension and translation up
to the consumer.

Authorisation will also be needed at this point, and defining the
appropriate primitives may not be straightforward. An initial stab might
include 'read any instance of schema X' and 'read individual instance',
where the latter could be granted on a group. Probably 'read all
instances on connection X' would be appropriate too, where teams working
in a particular cell are concerned.

Provider configuration is also dynamic. The reconcilation service will
need to be aware of any ConfigDB changes that may affect the
reconcilation result

### Deploying and configuring Edge Agents

This is essentially straightforward, but may be fiddly to get right. We
have a changing set of (principal, connection, instance) associations
and need to create appropriate _Edge deployment_ and _Edge Agent config_ 
ConfigDB entries.

Each active connection should result in the deployment of no more than
one Edge Agent. It may be sensible to combine connections from the same
(set of) hosts into a single Edge Agent; there will definitely need to
be limits here. Each (principal, connection) pair should result in the
deployment of a single Device under the appropriate Edge Agent Node, as
authorisation happens at the level of a Device.

Layout of the requested instances into the Device's metrics will require
a little care. As a rule we do not want to expose any instance more than
once on the same Device; this is wasteful. Where an instance and one of
its sub-instances are both active it will usually be necessary to ensure
they are in their correct relationship; however this raises a problem
where initially a child instance is active and then later the parent
instance also becomes active.

### Moving instances

If the child is already exposed at the root of the Device then it will
need to be moved under the parent. Given the inherent delay in
reconfiguring the Edge Agent, notifying the consumer via the Rendezvous
service, and the consumer reacting to the notification, it is likely
data will be missed as a result; this is unacceptable, especially as the
request for the parent data may come from a different consumer using the
same credentials. This is ignoring the current Edge Agent behaviour
which causes data loss on any config change; that can and should be
fixed.

The only way to move an instance while avoiding data loss is to
temporarily duplicate the instance, and advertise both metric locations
to the consumers in advance of the move. Consumers have the information
to deduplicate here but this is not an ideal situation, especially as
it's not likely to happen often and so won't be a well-tested code path.

The easiest solution here in the long run is to avoid the problem by
keeping the schema structure relatively flat, and only using sub-schemas
where the child data is unlikely to be wanted without at least some of
the parent data. Other relationships (including things like robot →
axis) can be represented with a Link instance instead. With this policy
it would be possible to always create the 'complete' instance structure
down from an instance with no parent.

With the current ConfigDB this would require an index of child → parent
relationships, probably calculated on the fly by the Reconcilation
service. This could either be a complete index of all instances, updated
via ConfigDB change-notify, or could be constructed from a query of all
instances attached to a given connection. Which of those is better will
depend to a degree on how many instances we expect per connection.

### Giving the consumer access

From the Reconciliation Service's point of view, granting access is
simple. Every time we create a new Device for a given principal, we
grant that principal rights to access the Device. Under the current Auth
system, dynamic Devices will need to have their addresses preregistered
in the ConfigDB, and the Reconciliation Service will need very broad
rights to grant access to MQTT. The proposed Auth service changes would
allow this to be permitted more flexibly.

Notifying the consumer via the Rendezvous service is also
straightforward. The problem of successfully consuming these
notifications, obtaining the data and making sense of it will obviously
need addressing.

It would also be possible to address the question of historical access
here. It would be straightforward to label dynamic Devices with their
intended consumer, either over Sparkplug or in the ConfigDB. With a
fairly minor modification to the Influx ingester it would then be
possible to record each user's data into their own private Influx
bucket, meaning we could apply Influx's ACLs in a useful way.

## Additional considerations

### MQTT auth

The current HiveMQ auth plugin fetches an ACL for each client on
connection. This ACL is then fixed for the life of the connection. If we
are dynamically creating devices and granting a consumer access to them
this will have to change. Working out how to enable change-notify for
auth changes is the first step, whether this means a change-notify
interface from the Auth service or pushing more of the ACL resolution to
the consuming service with references to data sources which themselves
have change-notify. Watching for change-notify from with HiveMQ will
also be non-trivial, unless the plugin is moved out of process.

### Southbound credentials

Something that will need considering here is how to store authentication
information securely. The current system transports this information to
the edge cluster securely but has (by design) no way to retrieve it.
Moving a connection across clusters would either require keeping this
information centrally, which is less secure, or would require
re-entering credentials or creating new credentials when a connection
moves.

