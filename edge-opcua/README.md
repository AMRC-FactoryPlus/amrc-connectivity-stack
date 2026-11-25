# edge-opcua: OPC UA split driver

An Edge Agent split driver for OPC UA servers, written in Rust on
[`lib/rs-edge-driver`](../lib/rs-edge-driver) and the
[async-opcua](https://github.com/freeopcua/async-opcua) client. It
replaces the Edge Agent's built-in OPC UA connection
(`acs-edge/lib/devices/OPCUA.ts`) and takes the same connection
details. Service-setup moves every built-in OPC UA connection to it on
upgrade (`acs-service-setup/lib/split-drivers.js`): the details move
from `OPCUAConnDetails` to `DriverDetails`, the payload format changes
from "Defined by Protocol" to JSON, and metric paths are removed,
because this driver's values leave nothing for a path to select (its
DriverDef has `metricPaths: false`). See
[Split Drivers](../docs/architecture/edge-management/split-drivers.md).

[Adding a Rust Driver](../docs/development/rust-drivers.md) covers the
build, CI and publishing steps.

## Connection details

Field|
---|---
`endpoint`|`opc.tcp://host:port`, with an optional path
`securityMode`|`None`, `Sign` or `SignAndEncrypt`
`securityPolicy`|`None`, `Basic128Rsa15`, `Basic256`, `Basic256Sha256`, `Aes128_Sha256` (Aes128_Sha256_RsaOaep) or `Aes256_Sha256_RsaPss`
`useCredentials`|log in with `username` and `password` rather than anonymously
`username`, `password`|

The DriverDef also lists Basic128, Basic192, Basic192Rsa15,
Basic256Rsa15, PubSub_Aes128_CTR and PubSub_Aes256_CTR. No OPC UA
server offers these for a client connection and the built-in
connection can't connect with them either, so the driver reports
`CONF` for them. With security mode `None` the policy field isn't
read at all. (The built-in sent the policy anyway, and the server
refused the channel, so such a connection never worked.)

The driver asks the server for its endpoints, takes the one with the
configured mode and policy, and connects to it at the configured URL,
not the one the server advertises, as node-opcua did.

## Addresses

An address is a node id in the standard string form, for example
`ns=2;s=Line1/Speed` or `ns=0;i=2258`. An address that is not a node id
is logged and gets no data, and the rest of the connection carries on.
Two spellings of the same node, such as `i=2258` and `ns=0;i=2258`, are
two addresses.

### Array elements

An address can end in an index to read part of an array node. The
suffix is sent to the server as the OPC UA index range (`IndexRange`,
a `NumericRange`) of the monitored item, read or write, so the server
sends only that part.

Address|Reads|Published as
---|---|---
`ns=2;s=Line1/Temps[3]`|element 3 (from 0)|that element, a scalar
`ns=2;s=Line1/Temps[2:5]`|elements 2 to 5, both included|an array
`ns=2;s=Line1/Grid[1,2]`|row 1, column 2 of a 2D array|that element, a scalar
`ns=2;i=1001[4]`|element 4 of a numeric-id node|that element, a scalar

One element is published as a scalar, not an array of one, so a scalar
metric can use it. A slice is published as an array, as a whole array
is. The values are converted as any other value (see `src/value.rs`).
The suffix is the last `[...]` in the address and holds only digits,
`:` and `,`, so an id such as `ns=2;s=Alarm[high]` or
`ns=2;s=Line1[2]/Speed` is a plain node id.

**The exact node is tried first.** Many servers, Siemens and Beckhoff
PLCs among them, make each array element a node of its own whose id
ends in brackets, such as `ns=3;s="DB"."arr"[3]`. So an address that
is a node id as written is asked for as that node first. Only if the
server answers `BadNodeIdUnknown` for it is it asked for again, at
once, as the node without the suffix with the index range. Existing
addresses therefore read what they read before. The form that worked
is kept until the session reconnects or a new one starts, when it is
found again, and writes use the same form. An address that isn't a
node id as written, such as `ns=2;i=1001[4]`, is only asked for as an
element.

A write to an element writes that element only, with the same index
range, and the rest of the array is left as it was. Writes to a slice
are not supported: the server refuses them.

An index outside the array gets no data. The driver logs one line
naming the address, and the rest of the connection carries on, as for
a node the server doesn't have. Some servers (node-opcua among them)
monitor such an element without complaint and never send it a value,
so after making its subscriptions the driver reads each element once
to find these.

## What it does

As the built-in connection did:

- one session, retried forever, with a back-off of 1 to 20 seconds;
- values from subscriptions: one subscription per device poll interval,
  publishing at that interval, with monitored items sampled at it,
  queue size 1,000, oldest values kept, and the subscription settings
  the built-in used (lifetime count 100, keep-alive count 10, up to
  1,000 notifications per publish);
- after every reconnect the driver makes its subscriptions again, once
  it reports `UP`, so the server sends every item's current value and
  a value that changed while the connection was down is reported even
  if it doesn't change again (see "Reconnects" below);
- the value is sent whatever its status code, and nothing is sent when
  there is no value;
- any server certificate is accepted, and the client makes its own
  self-signed certificate (see "Certificates" below).

Each value is published on its address's data topic as
`{"value": v, "timestamp": ms}`, the decoded-value format in
`acs-edge/docs/edge-split.md`, so the device's payload format is JSON
with an empty path. The timestamp is when the driver received the
value, because the built-in's values were stamped when the agent
received them. `src/value.rs` has the table of how each OPC UA type is
written so that the agent decodes the same value node-opcua gave it.

Writes come as typed writes (`write/<address>`) and are answered on
`result/<id>`. Each Sparkplug type is written as the OPC UA type the
built-in wrote: Int8 as SByte, UInt8 as Byte, String and Text as
String, UUID as Guid, and the rest by name. A node that can't be
written is answered `RO`, a value the server won't take (wrong type, out
of range) `CMD`, anything else `ERR`.

## Differences from the built-in connection

- **No one-off read.** The agent sends every split driver a `poll` at
  each device's interval. Reading every node for each one would double
  the load on the server for values the subscription already sends, so
  the driver ignores polls. The built-in's one-off read only ran on a
  rebirth request, and it matched results to metrics by position, so
  it could give a metric another node's value. That bug is gone.
- **Every device gets its own values.** The built-in made one
  subscription per device but looked every notification up in the last
  device's subscription. node-opcua numbers each subscription's
  monitored items from 1, so on a connection with more than one device
  the other devices' values were dropped or reported as the last
  device's node. This driver gives each value to its own address.
- **The server going away is reported.** The driver reports `CONN`
  while the session is down, so the agent marks the devices offline
  and sends a new DBIRTH when it is back. The built-in kept them
  online with stale values.
- **DateTime values.** Sent as milliseconds, which the agent publishes
  as the date. The built-in passed node-opcua's `Date`, which the agent
  published as 0.
- **Values JSON can't hold.** NaN is dropped by the agent (the metric
  keeps its last value). Int64 and UInt64 are sent with every digit and
  the agent reads them exactly up to 2^53; the built-in passed
  node-opcua's `[high, low]` pair. See `src/value.rs`.
- **Values reach Sparkplug up to 10 ms later.** The driver protocol
  carries one address per data message, so the agent waits 10 ms after
  the first value of a notification to gather the rest into one DDATA
  per device, as the built-in sent (see "Gathering data" in
  `acs-edge/docs/edge-split.md`). Timestamps don't change.

## Certificates

For a connection with security mode `Sign` or `SignAndEncrypt` the
driver makes its own self-signed client certificate and keeps it in
`$DRIVER_STATE_DIR/pki/own/cert.der`. The edge-agent chart mounts
`DRIVER_STATE_DIR` as an `emptyDir` for drivers whose DriverDef sets
`stateDir` (the OPC UA split DriverDef does), so the certificate lasts
as long as the pod: a container restart keeps it, and a new pod makes
a new one, as the built-in connection did. `OPCUA_PKI_DIR` overrides
the directory; without either it is `$HOME/pki`.

A server set up to trust only the clients it is told to refuses each
new pod's certificate until someone trusts it there. When the driver
starts it logs the certificate's file and SHA-1 thumbprint, for
example

```
OPC UA client certificate /state/pki/own/cert.der, SHA-1 thumbprint 349d76a3...c7b5: the server must trust it for a SignAndEncrypt connection
```

and each time the server refuses the connection it logs that the
server may not trust the driver's certificate, with the thumbprint
again, and reports `AUTH`. Most servers file a refused certificate
under its thumbprint in a "rejected" list, so look for it there and
trust it. These lines show at the default log level. (async-opcua
also logs the refusal itself as `Received error Good, ... from server`
with a status that differs each time. Some servers, node-opcua among
them, send the refusal inside a secure-channel message that async-opcua
reads as a plain error, so it takes the channel id for the status.
Ignore that line.)

The driver trusts any server certificate. A server that comes back
with a new certificate (renewed, reinstalled or replaced) is picked up
without a restart: see "Reconnects".

## Logging

`VERBOSE` works as it does for every Rust driver (see
[`lib/rs-edge-driver`](../lib/rs-edge-driver)): `VERBOSE=ALL`, the
edge-agent chart's default, turns on `debug` for this driver and the
library but not for async-opcua, which at `debug` logs two or three
lines for every Publish and one for every monitored item.
`VERBOSE=ALL,opcua=debug` turns async-opcua's on too, and `RUST_LOG`
overrides both as usual.

## Reconnects

When the connection drops the driver reports `CONN`, and async-opcua
reconnects with a back-off of 1 to 20 seconds and moves or remakes the
subscriptions on the new session. The server then sends every item's
current value at once. If that happens before the driver library has
waited out its reconnect delay and reported `UP` again, the library
drops those values, so after every reconnect the driver deletes and
makes its subscriptions again once it is `UP`, and the server sends the
current values again. The same happens if the session holds fewer
monitored items than the driver made, which async-opcua's move can
leave without saying.

async-opcua reconnects with the endpoint the driver asked the server
for when it started, which holds the server's certificate as it was
then, so a server that comes back with a new certificate refuses every
attempt. Once three attempts in a row have failed, the driver asks the
server for its endpoints again, at most once every 30 seconds. If the
server answers with a different certificate, the driver ends the
session and starts a new one with the new endpoint, and then makes its
subscriptions again as after any reconnect. A short network drop is
over before three attempts fail, and a server that can't be reached or
answers with the same certificate leaves the session as it is, so
neither starts a new session.

## What the server refuses

A subscription or monitored item the server refuses is retried with a
back-off from 5 seconds to 5 minutes, with one log line when an
address is refused and one when the server starts monitoring it. A
PLC whose OPC UA server starts before its program has loaded its nodes
answers `BadNodeIdUnknown` for a while, and its addresses start getting
data once the nodes are there, without a restart. Items are asked for
in requests no bigger than the server's `MaxMonitoredItemsPerCall`
(1,000 at most), and a request the server says is too big is split.
A refusal for one poll interval (a server that allows few
subscriptions, say) leaves the other intervals working and the driver
`UP`: it doesn't fail the connection.

## When the Edge Agent falls behind

The driver hands values to the agent without waiting
(`try_publish`), because the server keeps sending whatever the
driver does. While more than `publish_queue_bytes` (16 MiB by default)
waits to go to the agent, new values are dropped, counted and logged
every 10 seconds, so the driver's memory stays bounded. A dropped value
is lost: the metric keeps its last value until the item next changes.
All the values of one notification are handed over back to back, so
they reach the agent well inside its 10 ms gathering wait and go out
in one DDATA.

## Server clocks

A server whose clock is out (a PLC on local summer time, say) is
allowed for: the client times its secure channel token renewal on its
own clock (`ignore_clock_skew`), so the channel is renewed in time
however far out the server's clock is. async-opcua then also moves
every DateTime it decodes onto the client's clock, so the driver adds
the offset back to DateTime values, and they reach the agent as the
server sent them, as they did through the built-in.

## The async-opcua version

`Cargo.toml` pins async-opcua to a commit on its master branch,
`cabe0c61` (9 November 2026). The last release, 0.19.0 (July 2026),
never sends another Publish after the server restarts, so data stops
for good (upstream issue #270, fixed on master in 7bed8169). Move to
the next release once there is one, and run this driver's integration
tests against it.

Known upstream issues that are still open on that commit:

- **#297:** after a dropped connection a secured session (Sign or
  SignAndEncrypt) can't be reactivated, so the client opens a new
  session and moves the subscriptions to it. No data is lost, but the
  old session stays on the server until its timeout. The driver asks
  for a 60 second session timeout, node-opcua's default, so they don't
  build up.
- **#289:** by default the client times its secure channel token
  renewal against the server's clock, so a server clock out by more
  than a quarter of the token lifetime makes the channel expire. The
  driver turns on `ignore_clock_skew`, which avoids it (see "Server
  clocks").

## Scanning the address space

The driver takes part in Edge Scout, which lists a device's addresses
so an operator can pick them in the Admin UI's origin map editor
instead of typing them. The protocol is the "Scouting" section of
`acs-edge/docs/edge-split.md`, and the driver only scans when the Edge
Agent advertises it, so it works with any Edge Agent.

A scan uses the driver's own session, because many PLC servers have
few session slots, and it shares that session with the subscriptions,
so data keeps flowing during a scan. It walks the server's address
space breadth first from Objects (`i=85`), or from the node a branch
scan names:

- It browses forward `HierarchicalReferences` and their subtypes, for
  Objects and Variables only, asking for up to 1000 references per
  node, and follows every continuation point with BrowseNext. When the
  scan stops early (a cancel, a cap or an error) it releases the
  continuation points it still holds. A request still running when the
  scan stops waiting for it, or when the Edge Agent's session ends, is
  left to a task of its own, which waits up to 30 s for the answer and
  releases the continuation points in it, because they belong to the
  driver's session and servers allow few of them.
- It sends one request at a time, with `pace_ms` (20 ms by default)
  between requests. A request names at most the server's
  `MaxNodesPerBrowse` or `MaxNodesPerRead`, and never more than 50
  nodes per Browse or 100 attributes per Read. When the server answers
  `BadTooManyOperations`, which a server does when it enforces limits
  it doesn't advertise, the batch halves and the pace doubles, up to
  2 s. When an answer is too big for the message size (the server
  says `BadResponseTooLarge`, or node-opcua's `BadTcpMessageTooLarge`),
  the batch halves, then a Browse of one node asks for a quarter as
  many references each time, down to 10. A node or attribute still
  too big on its own gets `more: true` or no value, and the scan
  carries on.
- Each node is listed once, under the first parent the walk reaches
  it from, so `Organizes` cycles end and a node with two parents is
  not listed twice.
- An Object is a folder and a Variable is a value. Both have the
  node's canonical id as their `id`, and a value has it as its
  `address`: namespace 0 is written `i=2258`, never `ns=0;i=2258`. A
  node outside namespace 0 carries its namespace URI in
  `detail.namespace_uri`, because the index can change when a server
  is rebuilt.
- A variable gets its DataType as a Sparkplug type: Boolean, SByte
  (Int8), Byte (UInt8), Int16 to UInt64, Float, Double, String,
  DateTime, Guid (UUID), LocalizedText (String) and enumerations
  (Int32). A subtype of one of these, such as Duration or a server's
  own enumeration, gets its supertype's type. Anything else, such as a
  structure or a ByteString, gets no type and `detail.ua_type`, the
  DataType's node id. An array gets no type and `detail.dims`, with 0
  for a length the server doesn't give. `access` comes from the
  UserAccessLevel and `description` from the Description.
- The Server object (`i=2253`) is skipped, and the scan says so, with
  the prefix `i=`, so the Admin UI never calls a mapped `CurrentTime`
  or `ServerStatus` metric missing. A scan whose root is inside the
  Server object lists it.
- A node at the depth cap is only checked for children, and gets
  `more: true` if it has any. A node the server won't let the driver
  browse (`BadUserAccessDenied`) gets `more: true` and
  `detail.denied`, and the scan carries on and ends with the reason
  `partial_access`.
- A lost session ends the scan with `CONN`, and the driver doesn't
  retry it. A root that is not a node id, does not exist, or is not an
  Object or a Variable ends it with `OPTIONS`.

Options, from the Scan panel:

| Option | Default | What it does |
|---|---|---|
| `include_server` | false | List the Server object too |
| `expand_arrays` | false | Give arrays of up to 64 elements an item per element, addressed `node[i]` or `node[i,j]` (see "Array elements"). An element whose id is already a node of its own, as a PLC's `node[3]` is, is listed once, as that node |
| `units` | false | Read each variable's EngineeringUnits property into `unit` |

The scan reads a variable's value only for a sample, when the scan
asks for samples and the variable has a Sparkplug type, and for the
length of an array that doesn't declare it, with `expand_arrays`. It
reads arrays with the index range `0:64` in each dimension, so the
answer holds at most 65 elements a dimension however long the array
is, and doesn't read arrays of more than two dimensions at all. It
asks for cached values (`maxAge` the Int32 maximum), so a gateway
server doesn't read the device for a scan.

The client accepts messages of up to 2 MiB (32 chunks of 64 KiB),
and any array or string that fits in one. async-opcua's defaults are
5 chunks, 1,000 array elements and 64 KiB strings, and it closes the
connection when it can't decode a message, so one long array in a
subscribed value or a scan's answer would put every device on the
connection offline.

**Load and size.** The test server's 20,445-node tree, 20,000
variables in 445 folders with PLC-style names and a description each,
takes 1,420 requests and about 3 s with no pace, and the default 20 ms
pace adds about 28 s to that. It comes to 6.8 MB of items (334 bytes each) as the
Edge Agent stores them, and 208 KB gzipped. Real tag names repeat less
than the test server's, so expect a larger gzipped size. Each variable
costs one Browse slot and five attributes, so a server's own limits
decide how many requests a scan takes.

## Live values

While an operator has live values turned on in the Edge Scout panel,
the Edge Agent asks the driver for the current value of up to 40
addresses every few seconds. The driver reads them on its own session,
as a scan does, so it opens no session or subscription for them:

- One Read of the `Value` attribute for every address, split into
  batches of the server's `MaxNodesPerRead` (read once a session, at
  most 100). On `BadTooManyOperations` the batch halves. The Read asks
  for source timestamps and allows a value up to 1 s old (`maxAge`), so
  a server may answer from its cache.
- An address that ends in an array index is read as the node it names
  first, as the subscriptions read it. When the server says that node
  does not exist, a second Read asks for the node without the suffix
  with the index range, and a single element is shown as a scalar.
- A bad status goes in the entry's `error` by name, such as
  `BadNodeIdUnknown`, with no value. An uncertain status keeps the
  value and names the status in `error`. An address that is not a node
  id gets `Not an OPC UA node id`.
- The value goes as text: numbers, booleans and strings as they are,
  NaN as `NaN`, and arrays and other values as JSON. `type` is the
  Sparkplug type of a scalar and null for an array or a structure.

## Layout

```
src/main.rs        logging and Driver::run, nothing else
src/lib.rs         the crate root, so the tests can reach the parts
src/config.rs      the connection details, with unit tests
src/addr.rs        node id addresses and array indexes, with unit tests
src/value.rs       OPC UA values to data packets and typed writes to
                   OPC UA values, with unit tests
src/subs.rs        the subscriptions: make them, retry what the
                   server refused, count what the session holds
src/handler.rs     the rs-edge-driver Handler: session, reconnects
                   and writes
src/scout.rs       scanning the address space, with unit tests
                   against a fake server in src/scout/tests.rs
src/read.rs        live values, with unit tests against the same
                   fake server
tests/opcua.rs     the driver end to end against a node-opcua server
tests/scout.rs     scans and live values against the node-opcua
                   server's SCOUT mode
tests/clock.rs     a server whose clock is an hour fast
tests/refused.rs   a server that refuses the driver's certificate
tests/support/     that server, a TCP proxy and the fake Edge Agent
tests/server/      the node-opcua server, and scout.cjs, its address
                   space for scans
```

## Tests

`cargo test` runs the unit tests. The integration tests in
`tests/opcua.rs` need Node.js and acs-edge's `node_modules`, for the
node-opcua server, and run when `EDGE_OPCUA_SERVER_TESTS` is set:

```sh
(cd ../acs-edge && npm install --save=false --install-links)
EDGE_OPCUA_SERVER_TESTS=1 cargo test --test opcua --test clock --test refused --test scout
```

They cover every security mode and policy with and without
credentials, a wrong password (`AUTH`), the value of every OPC UA type,
a typed write of every Sparkplug type with its answer and the value
the subscription then reports, refused writes (`RO`, `CMD`, `ERR`),
bad addresses, array elements and slices (read, changed, written, out
of range, and a node whose own id ends in an index), reconnecting
after the server restarts, a server that
comes back with a new certificate, a value that changes during a short
connection drop, a node that appears after the server starts, low
server limits, a stalled agent, several devices on one connection, and
a server clock an hour fast. `tests/refused.rs` runs the driver binary
against a server that refuses its certificate and checks what it logs.
`tests/scout.rs` scans the server's `SCOUT` address space and checks
the exact item set, the Server object, the caps, a cancel releasing
its continuation points within a second, a denied branch,
`BadTooManyOperations`, a lost server, the data rate during a scan
with every option on and an array of 5,000 elements, folders whose
Browse is over the message size, the options, and the size of a
20,000-variable scan, which it prints.

The golden-output harness compares the Edge Agent's Sparkplug output
with this driver against the built-in connection's, from runs recorded
before ACS 7 removed it:

```sh
cargo build --release
cd ../acs-edge
GOLDEN_DRIVER=../edge-opcua/target/release/driver GOLDEN_PROTOCOL="OPC UA" \
    npx jest tests/golden -t "split driver"
```

`.github/workflows/edge-opcua.yaml` runs both on pull requests that
touch the driver, the driver library or the Edge Agent.
