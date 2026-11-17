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
`CONF` for them. With security mode `None` the policy is ignored.

The driver asks the server for its endpoints, takes the one with the
configured mode and policy, and connects to it at the configured URL,
not the one the server advertises, as node-opcua did.

## Addresses

An address is a node id in the standard string form, for example
`ns=2;s=Line1/Speed` or `ns=0;i=2258`. An address that is not a node id
is logged and gets no data, and the rest of the connection carries on.
Two spellings of the same node, such as `i=2258` and `ns=0;i=2258`, are
two addresses.

## What it does

As the built-in connection did:

- one session, retried forever, with a back-off of 1 to 20 seconds;
- values from subscriptions: one subscription per device poll interval,
  publishing at that interval, with monitored items sampled at it,
  queue size 1,000, oldest values kept, and the subscription settings
  the built-in used (lifetime count 100, keep-alive count 10, up to
  1,000 notifications per publish);
- after a reconnect the subscriptions are moved to the new session, or
  made again if the server can't move them;
- the value is sent whatever its status code, and nothing is sent when
  there is no value;
- any server certificate is accepted, and the client makes its own
  self-signed certificate. The built-in kept node-opcua's in the
  agent's `emptyDir`, so a new pod had a new certificate; this driver's
  lasts as long as its container. `OPCUA_PKI_DIR` sets where it is
  kept (default `$HOME/pki`).

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
- **A few more DDATA messages.** The driver protocol carries one
  address per data message. The agent gathers the values that arrive
  together into one DDATA per device, but a notification's later
  values sometimes arrive after the agent has sent its first group and
  go out in a second DDATA: between one and two per notification
  (measured 1.5 to 2.1 times the built-in's rate for 113 values), where
  the built-in sent one. The values and timestamps are the same.

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
- **#289:** the client times its secure channel token renewal against
  the server's clock. The driver asks for a one hour token lifetime, so
  a server clock up to 15 minutes fast or 45 minutes slow does no harm;
  further out, the channel drops and reconnects once an hour.

## Layout

```
src/main.rs        logging and Driver::run, nothing else
src/lib.rs         the crate root, so the tests can reach the parts
src/config.rs      the connection details, with unit tests
src/addr.rs        node id addresses, with unit tests
src/value.rs       OPC UA values to data packets and typed writes to
                   OPC UA values, with unit tests
src/handler.rs     the rs-edge-driver Handler: session, subscriptions
                   and writes
tests/opcua.rs     the driver end to end against a node-opcua server
tests/server/      that server
```

## Tests

`cargo test` runs the unit tests. The integration tests in
`tests/opcua.rs` need Node.js and acs-edge's `node_modules`, for the
node-opcua server, and run when `EDGE_OPCUA_SERVER_TESTS` is set:

```sh
(cd ../acs-edge && npm install --save=false --install-links)
EDGE_OPCUA_SERVER_TESTS=1 cargo test --test opcua
```

They cover every security mode and policy with and without
credentials, a wrong password (`AUTH`), the value of every OPC UA type,
a typed write of every Sparkplug type with its answer and the value
the subscription then reports, refused writes (`RO`, `CMD`, `ERR`),
bad addresses, and reconnecting after the server restarts.

The golden-output harness compares the Edge Agent's Sparkplug output
with the built-in connection and with this driver:

```sh
cargo build --release
cd ../acs-edge
GOLDEN_DRIVER=../edge-opcua/target/release/driver GOLDEN_PROTOCOL="OPC UA" \
    npx jest tests/golden -t "split driver"
```

`.github/workflows/edge-opcua.yaml` runs both on pull requests that
touch the driver, the driver library or the Edge Agent.
