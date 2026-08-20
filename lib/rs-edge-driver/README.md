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
    tracing_subscriber::fmt::init();

    let config = DriverConfig::from_env()?;
    let mut driver = Driver::<ModbusHandler>::new(config);
    driver.run().await
}
```

See [`examples/test_driver.rs`](./examples/test_driver.rs) for a
complete, runnable polled-mode driver, and
[`edge-compass-daq`](../../edge-compass-daq) in the main repo for a
real async-mode driver (subscribes to a southbound MQTT broker and
pushes data via `DriverHandle::publish` as it arrives).

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

`DriverConfig` also has `reconnect_delay` and `serial_poll` fields, but
`from_env()` currently hardcodes these (5 seconds, parallel polling)
rather than reading them from the environment — construct
`DriverConfig` directly if you need different values.
