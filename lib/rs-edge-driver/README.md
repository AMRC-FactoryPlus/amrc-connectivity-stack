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
- No data is published unless the status is `UP`.

The driver calls `connect`, `subscribe`, `cmd` and `close` on its own
tasks, so a slow or unreachable device never holds up the MQTT
connection to the Edge Agent and its keep-alive pings.

When the Edge Agent sends `active OFFLINE`, the driver closes the
handler and forgets its configuration until the agent sends `ONLINE`.

## Polling in parallel

`Handler::poll` takes `&mut self`, so polls through it run one at a
time. If your device client can serve several reads at once, return a
`Poller` from `Handler::poller` and the driver will call it without
taking the handler's lock, for every address in a poll request at
once. Set `serial_poll` in `DriverConfig` to force one poll at a time
either way. A poll's `poll_timeout` (in `DriverOptions`) starts when the poll starts, not
while it waits for the lock.

## API reference

The full API is documented via rustdoc — run `cargo doc --open` in
this directory, or read the doc comments directly in
[`src/handler.rs`](./src/handler.rs) (the `Handler` trait — the
interface driver authors implement) and
[`src/driver.rs`](./src/driver.rs) (`Driver` and `DriverHandle` — the
library's own runtime). Any method or property not documented there
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
