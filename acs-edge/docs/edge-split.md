# Edge Agent driver protocol

This is the specification of the protocol between the two halves of a
divided Edge Agent. The top half (the Edge Agent) handles configuration,
Sparkplug encoding, report-by-exception, and interaction with the rest
of Factory+. The bottom half (the driver) handles getting data out of
the southbound device and making it available to the Edge Agent.

The protocol was first written in June 2024 as a proposal. In November
2026 it was checked against the code and updated to describe what the
Edge Agent (`acs-edge`) and the three driver libraries
(`lib/js-edge-driver`, `lib/py-edge-driver`, `lib/rs-edge-driver`)
actually do. Where the code differs from the original proposal, a
paragraph marked **Implementation** says what the code does. Drivers
built outside this repository depend on that behaviour, so the
Implementation notes are the contract for new drivers.

One decision in this document is **proposed, awaiting Alex**. It is
marked where it appears: [Edge Scout](#edge-scout-address-browsing).

### Summary for driver authors

What a driver must do, and what it may leave out:

Part|Driver must|Notes
---|---|---
`status`|Publish `READY`, then `UP` or an error status. LWT `DOWN`.|
`active`|Publish its status on `ONLINE`.|`OFFLINE` may be ignored. No library acts on it today.
`conf`|Accept the driver configuration as JSON.|
`addr`|Keep the data topic to address map from `addrs`.|`groups` may be ignored.
`poll`|Read the listed addresses and publish data.|Push-only drivers may ignore it.
`data`|Publish one packet per address on `data/<data topic>`.|See [Data packet formats](#data-packet-formats).
`cmd`|Optional. Write the payload bytes to the address.|The address is everything after `cmd/`. Subscribe to `cmd` or `write`, not both.
`write`|Optional. Write the typed value to the address.|Needs an Edge Agent from November 2026 or later. See [Typed writes](#typed-writes).
`err`|Optional. Report a failed write or an address problem.|The Edge Agent logs it and takes no other action.
`result`|Required for a driver that subscribes to `write`. Answer a write.|The Edge Agent reports the written value only when the answer says it was written. See [Write results](#write-results).
`req`/`rsp`|Optional.|Only for the request kinds the agent serves.

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

**Implementation.** The Edge Agent makes one group per device, named
after the device, with the device's polling interval. It sends `groups`
but no driver library reads it. The Edge Agent owns the poll timer: it
sends a `poll` message for each device on that device's interval,
whether or not the driver's data source is asynchronous. A driver MAY
ignore `groups` entirely.

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

**Implementation.** The name is the connection's driver id: its
`driverId` in the Edge Agent config if it has one, or else its `name`.
The id is also the key of the driver in `values.drivers` of the Edge
Agent Deployment, so the chart uses it for `EDGE_USERNAME`, the
driver's password and, as `driver-<id>` in lowercase, the sidecar's
container name. A Kubernetes container name is at most 63 lowercase
letters, digits and hyphens, so a connection name only works as the
id if it is letters, digits and hyphens, ends in a letter or digit and
is at most 56 characters. A split driver connection with any other
name, such as `api.example.org`, is given a `driverId` when its config
is built: the name in lowercase with each run of other characters
replaced by a hyphen, then a hyphen and the first 8 hex digits of the
connection's UUID, here `api-example-org-1a2b3c4d`. The id is kept
once given, and the connection keeps its name everywhere else. The
Admin UI and service-setup both use `driver_ids` in
`lib/js-service-client/lib/edge-connection.js` for this, and
service-setup gives existing connections their ids when it runs.

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

**Implementation.** The Edge Agent uses random integers below 100000,
written in decimal. They are not stable across restarts, so a driver
MUST NOT store them.

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
`EDGE_USERNAME`|Driver connection name (its driver id)
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

**Implementation.** The Edge Agent publishes everything at QoS 0. The
driver libraries subscribe and publish at their client's default QoS
(0 or 1) and do not follow the QoS 2 conventions above. Nothing in the
protocol relies on QoS above 0.

Packets MUST NOT be published with the RETAIN flag set. The broker MUST
NOT allow retained messages.

## MQTT topics

All topics are under the namespace `fpEdge1`. Each driver then
communicates using topics under its own connection name. The Edge Agent
SHOULD disallow publish or subscribe packets to other topics.

**Implementation.** The Edge Agent's broker enforces these ACLs, where
`Conn` is the driver's connection name and `\w` is a letter, digit or
underscore:

Direction|Topics allowed
---|---
Driver publishes|`status`, `data/\w+`, `err/\w+`, `req/\w+`, `result/\w+`
Driver subscribes|`active`, `conf`, `addr`, `cmd/#`, `write/#`, `poll`, `rsp/\w+`

The broker drops a driver's whole connection if it subscribes to
anything else, so a driver that subscribes to `write/#` only works with
an Edge Agent that allows it (November 2026 or later).

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

**Implementation.** On `READY` the Edge Agent publishes `conf` and then
`addr` straight after it. On the first `UP` it publishes DBIRTH for the
connection's devices. A move from `UP` to `DOWN`, `CONF`, `CONN`, `AUTH`
or `ERR` makes it publish DDEATH. The JS library also publishes `ADDR`
when it rejects an address configuration. That status is not in the
table above, and the Edge Agent treats it as "not `UP`" without a
DDEATH.

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

**Implementation.** The Edge Agent publishes `ONLINE` when it opens the
connection and `OFFLINE` when it closes it, for example while reloading
its configuration. None of the three driver libraries acts on
`OFFLINE`. (The Python library also misses `ONLINE`, because it compares
the payload bytes' `str()` form with the string.) They wait for the next `ONLINE` and `conf` instead, which
works because the Edge Agent always sends a fresh `conf` after `READY`.
Handling `OFFLINE` is optional for drivers.

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

The data packet format is up to the driver and the device configuration
together. See [Data packet formats](#data-packet-formats).

    fpEdge1/Conn/cmd/Address

The driver subscribes to these topics with the wildcard subscription
`fpEdge1/Conn/cmd/#`. The Edge Agent publishes to these topics to write
data to the driver's southbound device.

**Implementation.** The original proposal put the data topic name after
`cmd/`. The Edge Agent has always put the **address** there instead, and
every published driver passes that string to its handler as the command
name, so the address is the contract:

* The address is everything in the topic after `fpEdge1/Conn/cmd/`. It
  MAY contain `/`, so a driver MUST NOT take only the next topic level.
  For example, a write to the address `plant/line1/speed` arrives on
  `fpEdge1/Conn/cmd/plant/line1/speed`.
* An MQTT topic cannot contain `+`, `#` or NUL, so the Edge Agent refuses
  to write to an address containing any of them and sends nothing.
* The Edge Agent only writes to addresses in the current address
  configuration.
* The Edge Agent publishes one `cmd` per metric written. Two metrics on
  the same address give two `cmd` messages.
* The payload is the metric's new value written as raw bytes for its
  Sparkplug type, whatever the device's payload format: integers and
  floats at their natural width in the metric's byte order (big-endian
  unless the metric sets `endianness`), Boolean as one byte 0 or 1, and
  String, Text and UUID as UTF-8. Int64 and UInt64 are 8 bytes, exact up
  to 2^53 because the Edge Agent receives the value as a JS number.
  Other types, including DateTime, have no `cmd` form, and the Edge
  Agent sends no `cmd` for them or for a value that doesn't fit its
  type. (Before November 2026 a 64-bit write sent 8 uninitialised bytes
  instead of the value.)
* Every write is also published as a [typed write](#typed-writes) on
  `write/<address>`. A driver that subscribes only to `cmd/#` never sees
  it, and gets exactly the `cmd` messages it always has.
* The Edge Agent does not wait for a driver that only takes `cmd`. It
  reports the new value in DDATA as soon as the write is published. It
  waits only for a driver that takes [typed writes](#typed-writes),
  which answers each one.

The JS and Python libraries before November 2026 took only the first
level after `cmd/`, so drivers built on them cannot write to an address
containing `/`. The Rust library has always taken the whole remainder.

When the Edge Agent publishes to this topic, the driver SHOULD attempt
to write the data to its southbound device at the location given by the
address. If the driver is unable or unwilling to write to the given
address it should report an `RO` address error. Drivers MAY refuse to
write to southbound devices in general.

    fpEdge1/Conn/write/Address

#### Typed writes

A `cmd` payload carries only the value's bytes, so a driver can't tell
an Int16 from a Float or a String. A driver that needs the type to
write, such as OPC UA, subscribes to `fpEdge1/Conn/write/#` **instead
of** `cmd/#`. The Edge Agent publishes every write to both topics, so
it doesn't need to know which form a driver uses, and a driver that
subscribed to both would write each value twice.

The address is the rest of the topic, under the same rules as for
`cmd`. The payload is a JSON object:

```json
{"type": "Int16", "value": -2}
```

`type` is the metric's Sparkplug type, and `value` is written like this:

Sparkplug type|`value`
---|---
Boolean|`true` or `false`
Int8, Int16, Int32, UInt8, UInt16, UInt32|number, an integer in range for the type
Int64, UInt64|string of decimal digits, for example `"-9223372036854775808"`, so a driver gets every digit. The Edge Agent receives DCMD values as JS numbers, so today the value is exact up to 2^53.
Float, Double|number, or the string `"NaN"`, `"Infinity"` or `"-Infinity"`, which JSON can't hold as numbers
String, Text, UUID|string
DateTime|number of milliseconds since the epoch

Other types (Bytes, File, DataSet, Template and the property sets) are
not sent. The byte order in a metric's `endianness` doesn't apply to a
typed write. A driver MUST ignore keys it does not recognise, so the
Edge Agent can add some later.

The payload may also have an `id`, a string of letters, digits and
`_`, for example `{"type": "Int16", "value": -2, "id": "9f3a1c02_7"}`.
An `id` means the Edge Agent is waiting for the answer, and the driver
MUST answer the write as described in [Write results](#write-results).
Without an `id` the driver doesn't answer, and if the write fails or
the driver can't use the value, it SHOULD report it on `err` as
described below.

    fpEdge1/Conn/result/Id

#### Write results

A driver that subscribes to `write/#` MUST answer every write that has
an `id` by publishing to `result/<id>`, with:

* an empty payload once the value has been written, or
* an error code (`RO`, `CMD` or `ERR`, as for `err` below), optionally
  followed by a newline and a message, if it was not.

A driver answers each write once. It answers a write it can't use
(an address not in its address map, a bad payload) with `CMD` straight
away, and doesn't also report it on `err`.

**Implementation.** The Edge Agent's broker notes each driver that
subscribes to its own `write/#`, and forgets it when the driver
unsubscribes or disconnects. For such a driver the Edge Agent puts an
`id` in every typed write and reports a written metric's new value in
DDATA only when the answer says it was written, so the value carries
the time of the answer. A refusal, or no answer within 10 seconds
(`DRIVER_WRITE_TIMEOUT`, in milliseconds), leaves the old value in
place, publishes nothing, and logs the device, metric, address and
reason to the console. Each write has its own `id`, so several may be
in flight at once, to the same address or different ones, and each
value is reported when its own answer arrives. An answer to an `id`
the Edge Agent isn't waiting for, such as one after the timeout, is
logged and ignored. The `id` starts with a random part chosen when the
connection starts, so an answer meant for an earlier run of the Edge
Agent can't match.

A driver that only subscribes to `cmd/#` can't answer. The Edge Agent
sends it no `id` and reports the value straight away, exactly as it
always has, and so do the built-in connections.

An Edge Agent from before this was added never sends an `id`, so a
driver that answers writes still works with it: it reports failures on
`err` as before.

The JS and Rust driver libraries support both forms, and the Python
library only `cmd`. In `lib/js-edge-driver` a
handler class that sets `static typedWrites = true` gets typed writes
through its `write(addr, type, value)` method, and any other handler
gets `cmd` as before. In
`lib/rs-edge-driver` a handler sets `TYPED_WRITES` to `true` and
implements `Handler::write`. In both, the library answers a write with
an `id` on `result` when the handler's `write` returns or fails, so a
handler needs no code for it, and a write without an `id` that fails is
reported on `err` for the handler.

    fpEdge1/Conn/err/Data

The driver publishes to this topic to report an error with a particular
address.

**Implementation.** The Edge Agent logs each message it receives here,
with the address, and takes no other action. Reporting errors is
optional for drivers.

The payload is an error code from the table below, optionally followed
by a newline and a message for the log, for example `RO` or
`CMD\nBadTypeMismatch`.

**Failed writes.** A driver that fails to write a `cmd` or typed
`write` SHOULD publish `RO`, `CMD` or `ERR` to the error topic of the
data topic for that address. A write error reports that one write
only: the driver does not clear it, and it does not stop data for the
address. The Edge Agent has already reported the new value in DDATA
by then (see `cmd` above), so the error only reaches the log. A typed
write with an `id` is answered on [`result`](#write-results) instead.
When a typed write handler fails, the driver libraries publish the
code the handler gives (`ERR` if it gives none) with its message, and
they publish `CMD` for a typed write they can't use.

The rest of this section is the original design for errors reading an
address, which no driver library implements yet.

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

**Implementation.** The Edge Agent sends a pending address
configuration before any `poll` or `cmd` that depends on it, and never
sends an empty `poll`.

    fpEdge1/Conn/req/Kind
    fpEdge1/Conn/rsp/Kind

**Implementation.** These topics were added after the original proposal.
A driver has no Factory+ identity of its own, so it asks the Edge Agent
to fetch specific things on its behalf. The driver publishes a request
to `req/<kind>` and the Edge Agent answers on `rsp/<kind>`. The driver
must subscribe to `rsp/<kind>` itself, because the libraries don't. Both
are optional, and only the kinds below exist:

Kind|Request payload|Reply (JSON)|Used by
---|---|---|---
`cassette`|A Cassette UUID|`{"uuid", "cassette"}` or `{"uuid", "error"}`|edge-sim
`file`|A Files service file UUID|`{"uuid", "size", "content"}` (content is base64) or `{"uuid", "error"}`|edge-ftp

Any other kind gets `{"error": "Unknown request: <kind>"}`. Files over
the Edge Agent's `DRIVER_FILE_LIMIT` are refused.

## Data packet formats

The Edge Agent decodes a data packet using the device's payload format
(`payloadFormat` in the device configuration) and each metric's path.
"Defined by Protocol" only suits connections built into the Edge Agent
and gives nothing for a split driver, so every split driver's devices
must name a real format. There are two kinds of split driver.

### Pass-through drivers (MQTT, REST and similar)

A driver whose southbound data is already a byte payload, such as an
MQTT message or an HTTP response body, publishes those bytes unchanged
as the data packet. The device's existing payload format (JSON, XML,
Delimited String, Buffer and so on) and the metric paths keep working
exactly as they do for the built-in connection.

### Decoded-value drivers (OPC UA and similar)

A driver whose southbound library hands it typed values, such as an OPC
UA client, publishes one JSON object per address:

```json
{"value": 21.5, "timestamp": 1763380800123}
```

The device uses payload format `JSON` and each metric's path is empty.
With an empty path the Edge Agent takes `payload.value`, and it takes
the timestamp from `$.timestamp`. A timestamp in seconds is converted
to milliseconds. Two optional keys are also read: `timestampNs`, a
string of nanoseconds since the epoch, which takes precedence for
sub-millisecond precision, and `simulated` with `run_id`, which
edge-sim uses to mark simulated data.

The Edge Agent tests (`tests/lib/helpers/driverPayload.test.ts`) check
how each Sparkplug type survives the trip from this payload to a
Sparkplug payload and back:

Sparkplug type|JSON `value`|Result
---|---|---
Int8, Int16, Int32, UInt8, UInt16, UInt32|number|Exact
Int64, UInt64|number|Exact up to 2^53. Larger values lose precision, even when sent as a string.
Float|number|Rounded to 32 bits by Sparkplug, as for the built-in connection
Double|number|Exact. NaN and infinities can't be sent, because JSON writes them as `null`.
Boolean|`true` or `false`|Exact
String, Text|string|Exact, except that the empty string is published as null
DateTime|milliseconds since the epoch, or an ISO 8601 string|Exact to the millisecond

Numbers may also be sent as strings, which are parsed for the metric's
type. A `null` value is ignored, so the metric keeps its last value.
This is the format edge-sim already uses.

## Gathering data

Each data packet carries one address, but a built-in connection hands
the Edge Agent all the values of an OPC UA notification or a poll
together, and each device publishes one Sparkplug DDATA for them. So
that a split driver doesn't multiply the Sparkplug traffic, the Edge
Agent gathers the data packets that arrive together and hands them to
the devices as one group. Each device publishes one DDATA for the
values in the group that belong to it.

* Packets that arrive in the same turn of the agent's event loop form a
  group: in practice, whatever the agent reads from the driver's socket
  in one go. The group is handed on at the end of that turn, so a
  packet on its own is not held back.

* `DRIVER_DATA_WAIT_MS` in the Edge Agent's environment makes it wait
  that many milliseconds after the first packet of a group instead,
  up to 100. The default is 0. Every packet waits up to that long, a
  lone one included.

* A second packet for an address already in the group hands the group
  on first, so every value is published, in the order the driver sent
  them.

* Any other packet from the driver, such as a status change or a write
  result, and any write the agent sends, hands the group on first, so
  the data is published before what followed it.

* Each address in a group is read as if it had come alone: a metric
  with no path still reads the whole payload, and a metric whose
  payload has no timestamp is stamped with when its packet arrived.

A driver SHOULD publish the values it gets together (one notification,
the results of one poll) back to back, so that they reach the agent in
as few socket reads as possible. Nothing else in the protocol changes.

With 100 values changing 10 times a second on one device through a
split driver, the agent publishes 10 DDATA a second, as the built-in
OPC UA connection does. With 1,000, a burst arrives in two or three
socket reads, so it publishes 20 to 30 a second rather than 10,000.

## Edge Scout (address browsing)

**Proposed, awaiting Alex.** Edge Scout, which lists a device's
addresses for the Admin UI, is not supported for split drivers for now.
The protocol has no browse message, and only the built-in OPC UA and
MQTT connections implement browsing. No Scout code is removed while
those built-in connections remain. If browsing is needed for a split
driver later, it can be added as a new `req`/`rsp` kind without changing
the rest of the protocol.
