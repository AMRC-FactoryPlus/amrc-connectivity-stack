# Edge Agent driver protocol

This is a specification for a proposed protocol between the two halves
of a divided Edge Agent. The top half (the Edge Agent) will handle
configuration, Sparkplug encoding, report-by-exception, and interaction
with the rest of Factory+. The bottom half (the driver) will handle
getting data out of the southbound device and making it available to the
Edge Agent.

## Definitions

These are some terms used below.

### Address

This represents a particular data source within a driver's southbound
device. The address itself is a string in a driver-specific format. The
driver can read an address, the result of which is a binary data packet.

### Address group

Addresses may be collected into groups and each group is assigned a name
by the Edge Agent. Each group may be assigned a poll interval, which
indicates the frequency at which the Edge Agent would like to receive
updates to the addresses in the group. A single address MAY appear in
more than one group.

### Address configuration

A configuration packet passed from the Edge Agent to the driver
specifying the addresses currently in use and their data topic names. A
given address MUST NOT be associated with more than one data topic name
within a given address configuration. The address configuration is in
JSON form and is an object with these properties:

* `version`: The integer `1`.
* `addrs`: An object whose keys are data topic names and whose values
  are addresses.
* `groups`: An object whose keys are group names and whose values are
  objects with these properties:
    * `addrs`: An array of data topic names from the top-level `addrs`
      property.
    * `poll`: An integer giving the requested poll interval in
      milliseconds for this group.

### Asynchronous (driver address)

Some driver addresses are asynchronous, meaning that data arrives from
the data source without prompting from the driver. Some are only
asynchronous, meaning that the driver cannot request data and must wait
for it. Drivers are not expected to cache data or poll data sources on a
timer.

### Connection name

This is a name used by the Edge Agent to identify a particular driver.
This MUST be a short string consisting of letters, numbers and
underscores. The name is assigned by the Edge Agent configuration and
needs to be supplied to the driver when it is deployed.

### Data packet

When a driver reads an address, or an address pushes data to the driver
asynchronously, the result is a binary data packet. This data packet may
then be published on an appropriate data topic. Depending on its
configuration, the Edge Agent may expect this data packet to have a
certain format and may attempt to parse multiple Sparkplug metrics out
of a single packet.

### Data topic name

The Edge Agent configuration specifies the list of device addresses that
the Edge Agent is interested in at the moment. Because device addresses
are potentially long strings containing arbitrary characters, the Edge
Agent assigns a data topic name to each address it is currently using.
These MUST be short strings of numbers, letters and underscores.

The Edge Agent MUST manage data topic names in such a way as to avoid
problems with synchronisation, and MUST NOT assume a driver will react
instantly to a new address configuration.

### Driver configuration

Configuration specific to a particular driver, containing connection
information and credentials and so on. This is in JSON form and is
passed to the Edge Agent as part of the Edge Agent configuration.

### Edge Agent configuration

The Edge Agent configuration is a JSON document managed by the Factory+
infrastructure and retrieved by the Edge Agent. It contains information
about configured drivers and instructions for mapping driver data
packets to Sparkplug metrics.

## Connection and authentication

The Edge Agent provides an MQTT broker interface for drivers to
communicate with. Currently (due to likely implementation restrictions)
this will be an MQTT 3.1.1 broker supporting username/password
authentication only. Where a driver is run outside of the edge cluster
the Edge Agent broker port will need to be made available externally.

The driver is an MQTT client. The driver MUST authenticate to the Edge
Agent broker using its connection name as both username and client-id,
and a password. This information must be supplied to the driver as part
of its deployment.

Drivers which run as standalone applications SHOULD accept the following
environment variables:

Name|Meaning
---|---
`EDGE_MQTT`|URL of the Edge Agent MQTT broker
`EDGE_USERNAME`|Driver connection name
`EDGE_PASSWORD`|MQTT password

Drivers MUST accept and support `mqtt://` URLs, including understanding
that the port defaults to 1883, and MAY accept `mqtts://`, `ws://` and
`wss://` URLs.

## MQTT data packets

Under normal circumstances MQTT QoS 0 should be adequate and avoids
additional overhead. However, to allow for situations where it is not,
drivers SHOULD obey these conventions:

* The driver SHOULD set up its subscriptions and wait for the SUBACKs
  before publishing anything.

* The driver SHOULD subscribe with QoS 2 to allow the Edge Agent the
  choice of what QoS to use.

* The Edge Agent MAY downgrade the subscription in the SUBACK, and MAY
  publish with a lower QoS.

* The driver SHOULD observe the QoS granted for the `conf` topic and use
  this QoS for all its PUBLISH packets. The driver SHOULD also observe
  the QoS on all packets received on that topic and update its current
  PUBLISH QoS.

Drivers MAY instead choose to publish and subscribe entirely at QoS 0.

Packets MUST NOT be published with the RETAIN flag set. The broker MUST
NOT allow retained messages.

## MQTT topics

All topics are under the namespace `fpEdge1`. Each driver then
communicates using topics under its own connection name. The Edge Agent
SHOULD disallow publish or subscribe packets to other topics.

In these examples the connection name `Conn` will be used. Where
necessary the data topic name `Data` will also be used.

    fpEdge1/Conn/status

The driver publishes to this topic. All messages MUST be a single string
from this table reporting on the status of the driver's southbound
connection:

Status|Meaning
---|---
`DOWN`|The driver is not connected or not running
`READY`|The driver is waiting for configuration
`UP`|The connection is up and ready
`CONF`|There is a problem with the driver configuration
`CONN`|The driver cannot connect because of networking problems
`AUTH`|The driver cannot authenticate southbound
`ERR`|Some other error has occurred

`CONN` should be used for situations such as a hostname that won't
resolve or a southbound device not accepting incoming connections.
`AUTH` should be used if the driver has successfully connected to the
southbound device but cannot authenticate using the information in its
configuration. `ERR` should be used for other error situations, such as
a protocol error on the southbound connection.

The driver MUST publish `READY` to this topic as soon as it has
connected to the broker and set up its subscriptions, unless it has
resumed an MQTT session and has its configuration already available. The
driver MUST include a LWT in its CONNECT packet publishing `DOWN` to
this topic.

The driver MUST NOT publish data packets when the most recent message
published to this topic is anything other than `UP`.

    fpEdge1/Conn/active

The driver subscribes to this topic. All messages MUST be a single
string, either `ONLINE` or `OFFLINE`, indicating whether the Edge Agent
expects this driver to be active. On receipt of an `ONLINE` status, the
driver MUST publish its current status to its `status` topic. On receipt
of an `OFFLINE` status, the driver MUST discard any configuration and
revert to `READY` status, and SHOULD disconnect from its data sources if
possible.

    fpEdge1/Conn/conf

The driver subscribes to this topic. The Edge Agent MUST publish the
driver configuration to this topic whenever the driver publishes a
`READY` status. The Edge Agent MAY publish a new configuration at any
time.

    fpEdge1/Conn/addr

The driver subscribes to this topic. The Edge Agent publishes the
address configuration. The driver MUST record this information, and may
use it to configure its southbound connection. The Edge Agent MUST
republish the address configuration every time it publishes a driver
configuration. The Edge Agent MAY publish a new address configuration at
any time. 

A driver receiving a `version` it does not recognise MUST set its status
to `CONF`. A driver MUST accept and ignore additional keys it does not
recognise. The Edge Agent MUST NOT supply additional keys except in
compliance with an updated version of this specification.

The driver SHOULD only attempt to honour a requested poll interval if
its device connection provides facilities for polling a set of
addresses. If data is not provided by the driver on time the Edge Agent
MUST poll explicitly.

If a driver is performing polling it SHOULD attempt to provide new
values for all addresses in a group in quick succession. The Edge Agent
MUST assume that any reported value stands until a new value is
reported and MAY choose to batch values reported upstream over
Sparkplug.

    fpEdge1/Conn/data/Data

The driver MUST publish to this topic whenever it has a new data packet
required by the current address configuration. The driver is not
expected to avoid sending duplicate data packets.

The driver MAY publish to this topic asynchronously if its southbound
data source is asynchronous. The driver SHOULD NOT attempt to poll on a
timer, leaving that up to the Edge Agent.

    fpEdge1/Conn/cmd/Data

The driver subscribes to these topics, preferably with a wildcard
subscription. The Edge Agent publishes to these topics to write data to
the driver's southbound device.

When the Edge Agent publishes to this topic, the driver SHOULD attempt
to write the data to its southbound device at the location given by the
corresponding address. If the driver is unable or unwilling to write to
the given address it should report an `RO` address error. Drivers MAY
refuse to write to southbound devices in general.

    fpEdge1/Conn/err/Data

The driver publishes to this topic to report an error with a particular
address.

If the driver has a problem accessing an address included in the current
address configuration, it MUST publish a single string from the table
below to the appropriate error topic. If the driver later succeeds in
accessing the address it MUST clear the error by publishing an empty
message to the error topic. The driver MUST NOT publish to a data topic
when an error has been reported.

Every time the driver publishes `UP` to the status topic this clears all
reported address errors. If the driver has a problem accessing an
address which is likely to indicate a problem communicating with the
southbound device altogether, the driver SHOULD report this via the
driver status topic rather than an individual error topic.

Error code|Meaning
---|---
`CONN`|Connection problem
`AUTH`|Authentication or authorisation problem
`RO`|The Edge Agent has attempted to `cmd` a readonly address
`WO`|The Edge Agent has attempted to `poll` a writeonly address
`CMD`|The Edge Agent has sent a `cmd` which is not acceptable
`ERR`|Some other error condition

The `CMD` code is for situations where the Edge Agent has published to a
`cmd` topic, and the driver believes it can write to the address, but
the format of the data packet supplied is not suitable for some reason.

    fpEdge1/Conn/poll

The driver subscribes to this topic. The Edge Agent publishes a message
to this topic to request the driver to poll certain addresses. This
message consists of previously-configured data topic names separated by
single newline characters.

The driver MUST attempt to read the address associated with each data
topic listed and publish a data packet, as soon as possible. If an error
occurs reading the address, an address error or driver status error MUST
be published. If a particular address cannot be explicitly read because
the data source is entirely asynchronous it MUST be ignored.
