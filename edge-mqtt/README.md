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
`protocol`|`mqtt` or `tcp` for plain TCP, `mqtts` or `tls` for TLS, `ws` or `wss` for a WebSocket on the path `/mqtt`
`host`, `port`|the broker
`clientId`|the MQTT client id. Blank makes one up, `NO-ID-<uuid>`, for each connection
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

## Layout

```
src/main.rs        logging and Driver::run, nothing else
src/lib.rs         the crate root, so the tests can reach the parts
src/config.rs      the connection details, with unit tests
src/topics.rs      which filters to subscribe to, with unit tests
src/write.rs       the payload for a write, with unit tests
src/handler.rs     the rs-edge-driver Handler: the broker connection
tests/driver.rs    the driver between a fake Edge Agent and a fake broker
tests/mosquitto.rs the driver against a real mosquitto, with passwords
tests/tls.rs       the driver against mosquitto over TLS
```

The mosquitto tests need `mosquitto`, `mosquitto_passwd` and `openssl`
on the PATH. Without them they are skipped with a note, unless
`EDGE_MQTT_MOSQUITTO=1` is set, as CI sets it.

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
