# edge-mqtt: MQTT split driver

An Edge Agent split driver for devices that publish to an MQTT broker.
It subscribes to each address as a topic on the device's broker and
passes every message's payload to the Edge Agent unchanged, so the
agent decodes it with the device's payload format and metric paths, as
it did for the built-in MQTT connection, which ACS 7 removed.
It takes the built-in's connection details field for field, so moving a
connection to it only moves them.

It is written in Rust on [`lib/rs-edge-driver`](../lib/rs-edge-driver)
and laid out like [`edge-test-rs`](../edge-test-rs).
[Adding a Rust Driver](../docs/development/rust-drivers.md) covers the
build, CI and publishing steps.

## Connection details

Field|Meaning
---|---
`protocol`|`mqtt` or `tcp` for plain TCP, `mqtts` or `tls` for TLS, `ws` or `wss` for a WebSocket on the path `/`, as the built-in uses
`host`, `port`|the broker
`clientId`|the MQTT client id. Blank makes one up, `NO-ID-<uuid>`, once, and keeps it across reconnects as the built-in does
`username`, `password`|sent only when the username is set
`cleanSession`|default true
`keepAlive`|seconds, default 60, 0 for none
`useSSL`|ignored, as the built-in ignores it: `protocol` decides

Over TLS the server's certificate is checked against the system's CA
certificates, as Node checks it for the built-in, so a server with a
self-signed certificate is refused. `SSL_CERT_FILE` names a different
CA file, for example one mounted from a secret.

## Addresses and data

An address is an MQTT topic filter, and wildcards are allowed. The
driver subscribes to each address once, at QoS 0, as the built-in does.
An empty address, or one that is not a valid filter, is left out and
logged.

Each message goes to the Edge Agent under its own topic, so it reaches
the metrics whose address is exactly that topic. A metric with a
wildcard address subscribes the driver to all matching topics but never
gets a value itself. The built-in works the same way, because the agent
looks each message up by its topic.

The driver never reads a payload, so its cost per message does not grow
with the number of metrics on a topic. Messages reach the agent in the
order the broker sent them. Messages larger than 16 MiB less 64 KiB,
the most the driver's link to the agent carries, are dropped with a
warning.

If the agent falls behind, the driver holds at most 16 MiB of messages
for it (`publish_queue_bytes`, met with `DriverHandle::publish_wait`)
and then stops reading
from the broker until the agent catches up. The broker then holds or
drops messages as it would for any slow client. The built-in behaves
the same way, because a busy agent stops reading its socket.

## Connection status

The status is `UP` once connected, `AUTH` if the broker refuses the
username or password, and `CONN` if it can't be reached or the
connection drops. The driver tries again every 10 seconds, as the
built-in does, and subscribes again when it reconnects. The agent marks
the connection's devices dead while the status is not `UP`. The
built-in does not: its devices stay alive while its broker is away.

## Writes

A write publishes the value to the address's topic as text (`21.5`,
`true`, `on`), at QoS 0 and not retained, and is reported written once
the MQTT client has taken it. The built-in instead builds the payload
from the device's payload format and the metric's path, which a split
driver is not given. No MQTT metric in use today is writable.

## Scanning a broker (Edge Scout)

The Admin UI's Addresses panel can ask the driver to list the topics a
broker carries, so an operator can pick addresses instead of typing
them. The driver does this only when the Edge Agent advertises
scouting, as `acs-edge/docs/edge-split.md` describes.

A scan opens a second connection to the broker with the same host, TLS
and credentials as the driver's own, but its own client id, a clean
session and no will. The driver's own session carries on untouched and
keeps passing data to the agent during the scan, unless the broker sets
the client id from the login (see below). The scan's client id
is the driver's client id followed by `-scout-` and 6 random hex
digits, or `fpscout-` and 12 random hex digits when that would be
longer than 23 characters. The scan subscribes at QoS 0, listens for
its window, lists what it heard and disconnects.

Option|Meaning
---|---
`filters`|the topic filters to listen on, default `["#"]`, at most 32
`seconds`|how long to listen, default 10, at most 120
`inspect_bytes`|payloads up to this size are inspected, default 65536, at most 1 MiB, 0 for none
`json_leaves`|list the leaves of JSON payloads, default true
`client_id`|the scan's own client id, for a broker that only accepts known ids. It can't be the driver's own

Topics starting with `$`, such as `$SYS/...`, are left out unless a
filter starts with `$`. A bad option ends the scan with `OPTIONS`.

What a scan lists:

* A folder for each topic level, with the id `a/b/`. Scanning a
  folder on its own listens on `a/b/#` and lists only what is under it.
* A value for each topic, with the id and address `a/b` and no path.
  `detail` has `count` (messages heard), `rate_hz` (live messages a
  second), `retained` and `format` (`json`, `text`, `xml`, `binary`,
  `empty` or `mixed`). A topic that also has child topics is both a
  value `a/b` and a folder `a/b/`. A topic whose name ends in `/` is
  the folder of the level before it, so it is one item, a value with
  children.
* A value for each leaf of a JSON payload, as a child of its topic,
  with the topic as its address and the JSONPath as its path, such as
  `$.speed` or `$.data[0].value`. The id is the topic, a NUL
  character, then the path. At most 200 leaves per topic and 8 levels
  of nesting are listed. A key with a quote, bracket or other
  character the Edge Agent's JSONPath could misread is left out.
* A type for each value: `Int64` when every sample was a whole number,
  `Double` when every sample was a number, else `Boolean` or `String`,
  and none when the samples were mixed, objects or binary.

How a scan keeps its load down:

* Each topic's first 16 messages are inspected, and later ones only
  counted. A scan inspects at most 32 MiB of payload in all.
* Retained messages, which arrive in a burst after the subscription,
  are inspected in full within those limits. Above 5,000 live messages
  a second, the scan stops inspecting payloads for the rest of its
  window and only records topics.
* The scan stops listening at the item cap and ends truncated with the
  reason `items`. A topic deeper than the depth cap gives its deepest
  listed folder `more: true`, and the scan ends truncated with the
  reason `depth`.
* The scan keeps up to 5 seconds of the Edge Agent's time cap to send
  what it found, so the listening window may be shorter than asked.

An MQTT scan is never exhaustive, because a topic that was quiet during
the window is missing but not gone, so the Admin UI never calls a
topic missing because a scan didn't hear it.

### Brokers that restrict what the driver may read

Brokers differ in how they answer a subscription the client may not
make. We checked mosquitto 2.0.21 and 2.1.4:

* With an `acl_file`, mosquitto grants every subscription, even to `#`
  or to a filter a `topic deny` line covers, and then leaves out the
  messages the client may not read. A scan under a narrow ACL
  therefore finds fewer topics and can't tell that it did.
* With the dynamic security plugin, mosquitto checks the filter itself
  and answers the SUBACK with a failure for a filter the client may
  not subscribe to.

When the broker refuses some filters, the scan carries on with the rest
and ends truncated with the reason `partial_access`. When it refuses
every filter, the scan ends with `AUTH` and "The broker refused every
filter. Give narrower filters." Give filters the driver's user may
read, such as `plant/#` in place of `#`. A broker that refuses the
scan's connection gives `AUTH`, and one that can't be reached gives
`CONN`.

### Brokers that set the client id from the login

Scanning is not safe on a broker that replaces the client id with the
user name. mosquitto does this with `use_username_as_clientid true`,
and with `use_identity_as_username` as well for certificate logins.
The scan logs in as the driver does, so the broker gives it the
driver's client id and drops the driver's connection, and the
`client_id` option can't help because the broker ignores it.

The scan therefore watches the driver's own connection. If that
connection drops during a scan, the scan stops at once and ends with
`CONN` and a message that names the setting, so the driver reconnects
once and carries on collecting data. On such a broker, turn the setting
off for the driver's user or don't scan. A broker with a limit on
connections per user may also refuse the scan's connection, which gives
`CONN` or `AUTH`.

## Layout

```
src/main.rs        logging and Driver::run, nothing else
src/lib.rs         the crate root, so the tests can reach the parts
src/config.rs      the connection details, with unit tests
src/topics.rs      which filters to subscribe to, with unit tests
src/write.rs       the payload for a write, with unit tests
src/survey.rs      what a scan heard, turned into scout items, with unit tests
src/scout.rs       a scan's own connection to the broker
src/handler.rs     the rs-edge-driver Handler: the broker connection
tests/driver.rs    the driver between a fake Edge Agent and a fake broker
tests/scout.rs     scans between a fake Edge Agent and a fake broker
tests/mosquitto.rs the driver against a real mosquitto, with passwords
tests/scout_mosquitto.rs  scans against a real mosquitto, with and without ACLs
tests/tls.rs       the driver against mosquitto over TLS
```

The mosquitto tests need `mosquitto`, `mosquitto_passwd` and `openssl`
on the PATH, and the scan tests also need mosquitto's dynamic security
plugin, which the Debian and Ubuntu packages include. Without them they
are skipped with a note, unless `EDGE_MQTT_MOSQUITTO=1` is set, as CI
sets it. The scan tests check every message against the schemas in
`lib/edge-scout-schemas`.

## Checking it against the built-in

The golden-output harness in `acs-edge/tests/golden` runs the real Edge
Agent with this driver and requires the same Sparkplug output as the
built-in connection gave, from runs recorded before ACS 7 removed it. From `acs-edge`, after
`npm install --save=false --install-links` there and `npm ci` in
`lib/js-edge-driver`, on Linux:

```sh
cargo build --release --manifest-path ../edge-mqtt/Cargo.toml
GOLDEN_DRIVER=../edge-mqtt/target/release/driver GOLDEN_PROTOCOL=MQTT npx jest tests/golden -t "split driver"
```
