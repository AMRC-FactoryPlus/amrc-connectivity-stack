# rs-edge-driver

A Rust library for creating Factory+ Edge Agent drivers.

This library exists to make it easier to write drivers for the ACS Edge
Agent. The Edge Agent exposes an MQTT broker for drivers to communicate
with and requires drivers to use a specific protocol for communication.
See the [JS edge driver library](../js-edge-driver) for the concepts
this library shares with the other language implementations; this
README covers the Rust-specific API shape.

Unlike the JS and Python libraries, which have separate `PolledDriver`
and `AsyncDriver` classes, this library uses a single [`Driver<H>`]
struct generic over one [`Handler`] trait. A handler chooses polled or
async mode by overriding the corresponding trait method — `poll` for
polled, `subscribe` for async. A handler may not usefully override
both.

## Core concepts

Dataflow is described along a south-north axis, where the Edge Agent
and the rest of Factory+ is 'north' of the driver, and the device the
driver is reading from is 'south'. Data normally flows from south to
north.

The Edge Agent communicates with a driver in terms of addresses. An
address is a string, in a format defined by the driver, which
identifies a particular data source within the driver's southbound
device. Address strings are entered into the Edge Agent configuration
by an administrator and passed down unmodified to the driver, which
validates and parses them via [`Handler::parse_addr`].

For each address currently in use, the Edge Agent also assigns a short
data topic name - **this is unrelated to the address's own contents**,
and drivers must not try to derive one from the address themselves. In
polled mode this is handled for you: `poll`'s topic pairing is resolved
by the library. In async mode, push data back via
[`DriverHandle::publish`], passing the same address the data came
from; the driver resolves it to the correct topic name internally, the
same way the JS and Python libraries' `AsyncDriver.data`/`data()`
methods do. Data for an address the Edge Agent isn't currently
interested in (e.g. immediately after reconfiguration) is silently
dropped, matching the other two libraries' behaviour.

A driver will normally require configuration for things like
hostnames, ports, and authentication. This configuration is included
in the Edge Agent config and passed to [`Handler::create`] as a JSON
value. If a changed config is received, the library destroys the
current handler and creates a new one — `Handler::close` is called on
the old handler first.

## Usage

```rust,ignore
use async_trait::async_trait;
use bytes::Bytes;
use rs_edge_driver::*;

struct ModbusHandler {
    handle: DriverHandle<ModbusAddr>,
    // ... client state
}

#[async_trait]
impl Handler for ModbusHandler {
    type Addr = ModbusAddr;

    fn create(
        handle: DriverHandle<ModbusAddr>,
        config: serde_json::Value,
    ) -> Result<Self, HandlerError> {
        // validate `config`, construct and return a handler
        todo!()
    }

    fn parse_addr(&self, raw: &str) -> Option<ModbusAddr> {
        // parse a driver-specific address string
        todo!()
    }

    async fn connect(&mut self) -> Result<(), ConnectError> {
        // establish the southbound connection
        todo!()
    }

    async fn poll(&mut self, addr: &ModbusAddr) -> Option<Bytes> {
        // polled mode: read one address on request
        todo!()
    }

    async fn close(&mut self) {
        // disconnect and clean up
    }
}

#[tokio::main]
async fn main() -> Result<(), Error> {
    init_logging();

    let config = DriverConfig::from_env()?;
    let mut driver = Driver::<ModbusHandler>::new(config);
    driver.run().await
}
```

See [`examples/test_driver.rs`](./examples/test_driver.rs) for a
complete, runnable polled-mode driver. `edge-compass-daq`, which is
kept outside this repository, is a real async-mode driver: it
subscribes to a southbound MQTT broker and pushes data via
`DriverHandle::publish` as it arrives.

An async handler that subscribes at a rate can override
`subscribe_groups` instead of `subscribe`. It gets the same addresses
plus the Edge Agent's groups from the `addr` message: one per device,
with the device's poll interval and its addresses (`AddrGroup`). The
default calls `subscribe`. `edge-opcua` uses it to sample and publish
each device's nodes at the device's interval.

Each call to `subscribe` replaces the previous set of addresses. If the
address map becomes empty after a handler has subscribed to some
addresses, `subscribe` is called with an empty list, so drop every
subscription then. It is never called empty before the first
non-empty call.

### A device that sends faster than the Edge Agent can take

`DriverHandle::publish` queues without limit. That suits a device that
sends at the rate it was asked for, but a device that pushes data on its
own, such as a UDP sender, can outrun the Edge Agent, and the queue then
grows until the container runs out of memory. Such a driver should call
`DriverHandle::try_publish` instead. It returns `false`, and drops the
data, while more than `DriverOptions::publish_queue_bytes` (16 MiB by
default, each message counting its payload plus
`PUBLISH_QUEUE_OVERHEAD`) is waiting to go to the agent. Count and log
what it refuses, so the loss is visible. Data from both calls goes out
in the order it was accepted. [`edge-udp`](../../edge-udp) does this.

When the device side can hold data back, as an MQTT broker does for a
slow subscriber, call `DriverHandle::publish_wait` instead. It meets the
same limit by waiting rather than dropping: the handler stops reading
from its device until the agent has taken enough, and nothing is lost
in the driver. [`edge-mqtt`](../../edge-mqtt) does this.

## Connection status

The driver reports its status to the Edge Agent on
`fpEdge1/{id}/status`. A handler drives it like this:

- `Handler::connect` returning `Ok(())` sets `UP`. Returning
  `ConnectError::ConnectionFailed` or `AuthFailed` sets `CONN` or
  `AUTH`, and the driver calls `connect` again after
  `reconnect_delay` until it succeeds.
- If the device goes away after `UP`, call
  `DriverHandle::disconnected(reason)` from anywhere in the handler.
  The status changes in the same way and the driver reconnects. For
  any other error, such as a protocol error, call
  `DriverHandle::error()`, which sets `ERR` and reconnects.
- Each report belongs to the latest `connect` call made before it.
  Reports from an earlier attempt are ignored, so a burst of reports
  about one lost connection causes one reconnect. A report made while
  `connect` is still running, such as from a device that drops the
  connection straight after accepting it, is acted on when `connect`
  returns, rather than reporting `UP`.
- A rejected address map is reported as `ADDR`, and stays `ADDR` when
  the handler connects again, until a good map arrives.
- No data is published unless the status is `UP`. A message over
  `max_packet_size` is dropped with a warning, because the MQTT client
  would otherwise end the whole session for it.

The driver calls `connect`, `subscribe`, `cmd`, `write` and `close` on its own
tasks, so a slow or unreachable device never holds up the MQTT
connection to the Edge Agent and its keep-alive pings.

When the Edge Agent sends `active OFFLINE`, the driver closes the
handler and forgets its configuration until the agent sends `ONLINE`.

## Writes

The Edge Agent sends each write in two forms, and a handler takes one
of them:

- By default the driver subscribes to `cmd/#` and calls
  `Handler::cmd` with the address and the value as raw bytes, as it
  always has.
- A handler that sets `const TYPED_WRITES: bool = true` gets typed
  writes instead. The driver subscribes to `write/#` and calls
  `Handler::write` with the parsed address and a `WriteValue`, which
  carries the Sparkplug type and the value (`WriteValue::Int16(-2)`,
  `WriteValue::Double(0.5)` and so on). Return `WriteError::ReadOnly`,
  `BadValue` or `Failed` if the write fails, and the driver reports it
  to the Edge Agent as `RO`, `CMD` or `ERR`. This needs an Edge Agent
  from November 2026 or later.

See "Typed writes" in `acs-edge/docs/edge-split.md` for the protocol.

## Polling in parallel

`Handler::poll` takes `&mut self`, so polls through it run one at a
time. If your device client can serve several reads at once, return a
`Poller` from `Handler::poller` and the driver will call it without
taking the handler's lock, for every address in a poll request at
once. Set `serial_poll` in `DriverConfig` to force one poll at a time
either way. A poll's `poll_timeout` (in `DriverOptions`) starts when the poll starts, not
while it waits for the lock.

## Scouting

Scouting lets the Admin UI ask a driver to list the addresses its
device offers, so an operator can pick them in the origin map editor
instead of typing them. The library handles the protocol, which is the
"Scouting" section of
[`acs-edge/docs/edge-split.md`](../../acs-edge/docs/edge-split.md). A
handler only produces items.

A handler that does nothing answers that it can't scan, and every scan
ends with `UNSUPPORTED`. To take part:

1. Set `const SCOUTS: bool = true` on the handler.
2. Return a `Scouter` from `Handler::scouter`. The driver asks for it
   after each successful `connect`, as it does for `poller`, and runs
   scans on their own task without the handler's lock, so polls and
   writes carry on during a scan. Return `None` when there is no
   connection to scan with, and the scan ends with `CONN`.
3. In `Scouter::scout`, send items with `sink.add(items).await?` and
   call `sink.pace().await?` between requests to the device. Return a
   `ScoutEnd`, or a `ScoutError` such as `ScoutError::options("...")`
   for a bad root or bad options.

```rust,ignore
struct MyScouter { client: Arc<DeviceClient> }

#[async_trait]
impl Scouter for MyScouter {
    async fn scout(&self, req: ScoutRequest, sink: ScoutSink) -> Result<ScoutEnd, ScoutError> {
        for folder in self.client.folders(req.root.as_deref()).await? {
            sink.add(vec![Item::folder(&folder.id, None, &folder.name)]).await?;
            for tag in self.client.tags(&folder).await? {
                let item = Item::value(&tag.id, Some(&folder.id), &tag.name, &tag.address)
                    .with_type(ScoutType::Double)
                    .with_access(Access::Read);
                sink.add(vec![item]).await?;
            }
            sink.pace().await?;
        }
        Ok(ScoutEnd::new(true))
    }
}
```

The library does the rest:

- It subscribes to `scout` only after the Edge Agent's `addr` message
  advertises `features.scout` on the current MQTT session, and forgets
  it on every reconnect. An Edge Agent from before scouting would drop
  the driver's connection for that subscription, so this keeps a new
  driver safe on an old Edge Agent, including after a rollback.
- It answers the Edge Agent's hello from `SCOUTS`, whatever state the
  handler is in.
- It numbers the messages, splits items into batches of at most 500
  items and 256 KiB, cuts names, descriptions, units and samples that
  are too long, and leaves out `sample` unless the scan asked for
  samples. It never cuts an address, path or root, because a cut one
  names a different place on the device. A value whose address or path
  is over 1024 characters goes out as a folder with nothing to bind, so
  its children keep their parent, and an item whose root is over 1024
  characters is dropped.
- `add` waits while the data waiting to go to the Edge Agent is over
  half the publish queue, so a scan gives way to data.
- At the item cap `add` returns `Stop::Items`, and the scan ends as
  truncated. A cancel from the Edge Agent or a new `conf` makes `add`
  and `pace` return `Stop::Cancelled` and `sink.cancelled()` fire, and
  the scan ends with `CANCELLED`.
- At `limits.seconds` it ends the scan as truncated, even if the
  scouter has stopped answering. A scouter that does not stop within
  3 s of a cancel or the time cap is aborted.
- A panic in the scouter ends the scan with `ERR`.
- A second scan that starts while one is running ends with `ERR`.
- It sends a progress message at least every 5 s. Call
  `sink.progress(Progress::new(visited))` to add counts and a note.

The scouter keeps to `limits.depth` itself, giving a folder at the cap
`more: true`, because the library can't see the device's structure.

An item's `id` must come from the device alone, never from the scan's
root, so a node has the same id in a full scan and in a branch scan. A
branch scan sets `req.folder_id`, and its first item must have that id.
An `address` must be in the driver's canonical form, the form the
driver prints from a parsed address. List the parts of the device the
scan skipped on purpose with `ScoutEnd::exclude`, so the Admin UI does
not call their addresses missing.

The tests check every message against the JSON Schemas in
[`lib/edge-scout-schemas`](../edge-scout-schemas). `tests/scout_mosquitto.rs`
runs the feature gate against a real mosquitto broker when `mosquitto`
is on the PATH, and fails without it when `RS_EDGE_DRIVER_MOSQUITTO=1`
is set.

## API reference

The full API is documented via rustdoc — run `cargo doc --open` in
this directory, or read the doc comments directly in
[`src/handler.rs`](./src/handler.rs) (the `Handler` trait — the
interface driver authors implement) and
[`src/driver.rs`](./src/driver.rs) (`Driver` and `DriverHandle` — the
library's own runtime) and [`src/scout.rs`](./src/scout.rs) (scouting). Any method or property not documented there
must not be relied on.

## Environment variables

The standard Edge Agent driver environment variables are supported via
`DriverConfig::from_env()`:

Name|Meaning
---|---
`EDGE_MQTT`|URL of the Edge Agent MQTT broker
`EDGE_USERNAME`|Driver connection name
`EDGE_PASSWORD`|MQTT password
`VERBOSE`|Log level, as for the JS drivers: `1` or `ALL` for debug, or a comma-separated list of targets (see `init_logging`)

`RUST_LOG` overrides `VERBOSE` when set. Call `init_logging()` at the
start of `main` to use them.

With `VERBOSE`, `debug` and `trace` lines from crates cargo downloaded
(from crates.io or git, such as rumqttc or an OPC UA client) only come
through for targets `VERBOSE` names. So `VERBOSE=ALL`, the edge-agent
chart's default, means `debug` for the driver and this library, and
`VERBOSE=ALL,rumqttc` adds rumqttc's, which logs every MQTT packet.
`init_logging` tells the crates apart by where their source is:
anything under cargo's `registry/src` or `git/checkouts` counts as
downloaded. `RUST_LOG` is used as it is.

`DriverConfig::from_env()` (or `DriverConfig::new(url, username,
password)`) sets `reconnect_delay` to 5 seconds and `serial_poll` to
`false`. Change the fields on the returned value if you need different
ones, or build the struct yourself.

Further settings are in `DriverOptions`. `Driver::new(config)` uses
their defaults. To change them, start from `DriverOptions::default()`
and pass it to `Driver::with_options(config, options)`:

Field|Default|Meaning
---|---|---
`poll_timeout`|30 s|Longest a single poll may run
`keep_alive`|30 s|MQTT keep-alive to the Edge Agent
`max_packet_size`|16 MiB|Largest MQTT packet sent or accepted. rumqttc's own default is 10 KiB, too small for a large `addr` map or data payload

## Using this library in a driver

Drivers in this repository depend on this library by path
(`rs-edge-driver = { path = "../lib/rs-edge-driver" }`). Drivers
elsewhere pin a release tag, `rs/edge-driver/vX.Y.Z`, by git. The
Dockerfile for a driver is in [`driver-template/`](./driver-template/Dockerfile),
and [Adding a Rust Driver](../../docs/development/rust-drivers.md)
covers the whole process, from code to a published image.
