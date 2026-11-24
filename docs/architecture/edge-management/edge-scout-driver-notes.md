# Edge Scout driver notes

Each driver decides what a scan of its device lists. This page says
what the drivers in this repository find, which options they take, and
how they keep the load on the device down. How to run a scan is in
[Scanning a device for addresses](edge-scout-scanning.md).

Every scan also keeps to the limits the Edge Agent sends: at most
20,000 addresses, 8 levels and 120 seconds by default, with a 20 ms
pause between requests to the device. The driver library enforces
these as well as the driver, so a driver that misses one still ends the
scan correctly.

## Which drivers can scan

Driver|Scans|What a scan lists
---|---|---
edge-opcua|Yes|The server's address space, from Objects
edge-mqtt|Yes|The topics heard on the broker during a short window, and the leaves of JSON payloads
edge-sim|Yes|The loaded cassette's channels and the player's own addresses
edge-test, edge-test-rs|Yes|A made-up tree, for testing scans
edge-ads, edge-bacnet, edge-ftp, edge-pathfindr, edge-rtde, edge-tplink-smartplug, edge-focas|Not yet|The panel says the driver cannot list its addresses. ADS symbol upload is the likely next scan
edge-modbus, edge-openprotocol, edge-rest, edge-udp|No|The protocol has nothing to list, and the panel says the driver cannot list its addresses
Drivers outside this repository|Depends|"Built before scouting" until the driver is rebuilt on a driver library from this release, then whatever it implements

Every driver in this repository is built on the driver library in the
same ACS release, so each one either scans or answers that it can't.
The JavaScript drivers depend on `lib/js-edge-driver` by a `file:`
path and the Rust drivers on `lib/rs-edge-driver` by a `path`
dependency, and their images are built with `lib/` as the `lib` build
context. None of them is built from a published copy of the library,
so none answers "built before scouting".

## edge-opcua

A scan uses the driver's own OPC UA session, because many PLC servers
have few session slots. Subscriptions carry on over the same session,
so data keeps flowing. A scan starts at Objects (`i=85`), or at the
folder a branch scan names.

**What it lists.**

- An Object is a folder and a Variable is a value. The `id` is the
  node's NodeId in the form the driver prints, and a value's address is
  the same. Namespace 0 is written `i=2258`, never `ns=0;i=2258`. When
  you compare, the Admin UI drops `ns=0;` from a metric's address, so
  an older metric written with it still matches.
- A Variable's DataType becomes its type: Boolean, SByte (Int8), Byte
  (UInt8), Int16 to UInt64, Float, Double, String, DateTime and Guid
  (UUID). LocalizedText becomes String and an enumeration Int32. A
  subtype of one of these, such as Duration, gets its supertype's
  type. Structures, ByteString and anything else get no type, and the
  details say the DataType's node id.
- An array gets no type, and the details give its dimensions. With
  **List array elements**, an array of up to 64 elements also gets one
  address per element, `node[3]` or `node[1,2]`, which the driver can
  read as a single value. An element that already exists as a node of
  its own, as a PLC's `node[3]` often does, is listed once, as that
  node.
- Access comes from the node's UserAccessLevel for the driver's user,
  and the description from its Description. A node outside namespace
  0 records its namespace URI, because the index number can change
  when a server is rebuilt.
- Each node is listed once, under the first parent the scan reaches it
  from, so a node with two parents appears once and loops end.

**What it skips.** The Server object (`i=2253`) is skipped unless you
tick **Include the Server object**. The scan reports namespace 0 as
not checked, so mapped `CurrentTime` and `ServerStatus` metrics are
never called missing. A branch scan inside the Server object lists it.

**Limits.**

- A folder at the depth limit is checked for children with one small
  request, and shows **more** when it has some. The scan then ends at
  the depth limit, and **Scan this branch** on that folder goes
  further.
- A branch the server refuses to let the driver browse
  (`BadUserAccessDenied`) is marked as denied, and the scan carries on
  and ends with "parts the driver was not allowed to read".
- Each request has the driver's 10 s request timeout.

**Load.** One request is in flight at a time, with the pause between
requests. A Browse names at most 50 nodes and a Read at most 100
attributes, or fewer when the server's OperationLimits say so. When a
server answers `BadTooManyOperations`, the batch halves and the pause
doubles, up to 2 s, for the rest of the scan. Every variable costs one
Browse slot and five attributes in a Read, so a server's limits decide
how many requests a scan takes. On the test server, 20,445 nodes took
1,420 requests: about 3 s with no pause, and about 28 s more with the
default 20 ms pause.

**Options.**

Option|Default|What it does
---|---|---
Include the Server object|off|List the Server object too
Read engineering units|off|Read each variable's EngineeringUnits property into its unit. A variable at the depth limit gets no unit
List array elements|off|List each element of an array of up to 64 elements as its own address

The options form also shows a **Start at** field, which the driver in
this release ignores. To scan part of a server, scan the whole server
and then use **Scan this branch** on the folder you want.

**Errors.** A lost session ends the scan with `CONN`, and the driver
does not retry it. A branch whose node does not exist, or is not an
Object or a Variable, ends with `OPTIONS`. A stop takes up to about
2.5 s, because the driver lets a request in flight finish so it can
release the server's continuation points.

More detail is in [`edge-opcua/README.md`](../../../edge-opcua/README.md).

## edge-mqtt

A scan opens a second, short-lived connection to the broker, with the
same host, TLS and credentials as the driver but its own client id, a
clean session and no will. The driver's own session is never touched,
so data keeps flowing. The scan subscribes, listens for its window,
lists what it heard and disconnects.

The scan's client id is the driver's client id followed by `-scout-`
and 6 random hex digits, or `fpscout-` and 12 random hex digits when
that would pass 23 characters. A broker that only accepts known client
ids can be given one with the **Client ID** option, which cannot be
the driver's own.

**What it lists.**

- A folder for each topic level, with an id ending in `/`, such as
  `plant/line1/`. **Scan this branch** on a folder listens on
  `plant/line1/#`.
- A value for each topic heard, with the topic as its address and no
  path. A topic that also has topics under it is both a value
  `plant/line1` and a folder `plant/line1/`.
- A value for each leaf of a JSON payload, under its topic, with the
  topic as its address and the JSONPath as its path, such as
  `$.speed` or `$.data[0].value`. At most 200 leaves a topic and 8
  levels of nesting are listed. A key containing quotes, brackets or
  other characters a JSONPath could misread is left out.
- A type for each value: Int64 when every message held a whole number,
  Double when every message held a number, otherwise Boolean or
  String, and none for mixed values, objects and binary payloads.
  Access is always unknown, because the scan cannot tell what the
  broker would let the driver write.
- Details: how many messages were heard, the live message rate,
  whether the topic was retained, and the payload format (JSON, text,
  XML, binary, empty or mixed).
- Topics starting with `$`, such as `$SYS/...`, are left out unless a
  filter starts with `$`.

**Never complete.** A topic that was quiet during the window is missing
but not gone, so an MQTT scan never counts as complete. The change bar
shows "Not seen this time" instead of "Gone", and no metric is called
missing because a scan did not hear it.

**Load.**

- Each topic's first 16 messages are inspected and later ones only
  counted, and a scan inspects at most 32 MiB of payload in all.
  Payloads larger than **Inspect payloads up to** are counted but not
  inspected.
- Retained messages arrive in a burst when the scan subscribes and are
  inspected in full within those limits. Above 5,000 live messages a
  second, the scan stops inspecting payloads for the rest of its
  window and only records topics.
- At the address limit the scan stops listening. A topic deeper than
  the depth limit marks the deepest folder listed as having more.
- The scan keeps up to 5 seconds of the Edge Agent's time limit to send
  what it found, so with the 120-second limit a 120-second window
  listens for 115 seconds.

**Options.**

Option|Default|What it does
---|---|---
Topic filters|`#`|The filters to listen on, at most 32
Listen for (seconds)|10|How long to listen, 1 to 120
Inspect payloads up to (bytes)|65536|Payloads up to this size are inspected, at most 1 MiB, and 0 inspects none
List JSON leaves|on|List one address per leaf of a JSON payload
Client ID|derived|The scan connection's client id

**Brokers that restrict reading.** Brokers answer a subscription the
client may not make in different ways. We checked mosquitto 2.0.21 and
2.1.4:

- With an `acl_file`, mosquitto accepts every subscription, even to
  `#`, and then leaves out the messages the client may not read. A scan
  under a narrow ACL finds fewer topics and cannot tell that it did.
- With the dynamic security plugin, mosquitto refuses a filter the
  client may not subscribe to.

When the broker refuses some filters, the scan carries on with the
rest and ends with "parts the driver was not allowed to read". When it
refuses every filter, the scan ends with `AUTH` and "The broker refused
every filter. Give narrower filters." Give filters the driver's user
may read, such as `plant/#` in place of `#`.

**Errors.** A broker that refuses the scan's connection for bad
credentials, a bad client id or no permission gives `AUTH`. A broker
that cannot be reached, a lost connection, or no answer to the
subscription within 10 seconds gives `CONN`, and what the scan heard
is dropped. A scan on a driver that is not connected gives `CONN`.

More detail is in [`edge-mqtt/README.md`](../../../edge-mqtt/README.md).

## edge-sim

With a cassette loaded, a scan lists:

- a **Player** folder with the player's 12 addresses (`player:load`,
  `player:status` and so on), with their descriptions. Controls are
  write-only and state addresses are read-only with the path `$.value`.
- every channel of the cassette, with its path as its address, the
  path `$.value`, its type without byte order, and its engineering
  unit. A `/` in a channel path makes a folder, as for MQTT topics.

With no cassette loaded the scan finds nothing, and the panel says
"Load a cassette first." The simulator takes no options.

## edge-test and edge-test-rs

The two test drivers list a made-up tree that depends only on the
options, so the same options always give the same addresses. They are
for testing the Edge Agent and the Admin UI, not for real devices. The
two drivers build different trees, so do not compare a scan of one
with a scan of the other. Their READMEs describe each tree.

Option|edge-test (JS)|edge-test-rs (Rust)
---|---|---
`size`|Values to list, default 100, at most 1,000,000|The same
`depth`|Folder levels, default 2, at most 32|Folder levels, default 2, at most 16
`fail`|End with `OPTIONS`, `CONN`, `AUTH`, `ERR` or `UNSUPPORTED`|End with `OPTIONS`, `CONN`, `AUTH` or `ERR`, or `PANIC` to panic (reported as `ERR`)
`hang`|Never return, so the time limit ends the scan|The same
`delay_ms`|Wait before each folder listing|Time each batch of 100 takes
`duplicates`|Send the first 10 values twice|List every value whose number ends in 0 twice
`after`|Items to list before `fail` or `hang` takes effect|Not accepted

Both refuse an option they do not know with `OPTIONS`. edge-test run
with `SCOUT_UNSUPPORTED=1` answers that it cannot scan, for testing
that state.

See [`edge-test/README.md`](../../../edge-test/README.md) and
[`edge-test-rs/README.md`](../../../edge-test-rs/README.md).

## Next steps

- [Scanning a device for addresses](edge-scout-scanning.md)
- [Adding scouting to a driver](edge-scout-drivers.md)
