# edge-rest: REST split driver

An Edge Agent split driver for HTTP devices, written in Rust on
[`lib/rs-edge-driver`](../lib/rs-edge-driver). It replaces the Edge
Agent's built-in REST connection, which ACS 7 removed, and
takes the same connection details, so a connection moves to it with no
change to its details, addresses or metric paths. Its DriverDef is
`ACS.Driver.RESTSplit` in `acs-service-setup/dumps/edge.yaml`, which the
Manager offers as "REST", and service-setup moves connections to it when
`serviceSetup.config.splitDrivers.REST` is `true`, which is the chart's
default (`acs-service-setup/lib/split-drivers.js`). See
[Split Drivers](../docs/architecture/edge-management/split-drivers.md)
for what a site sees when its connections move.

## Connection details

The built-in's `RESTConnDetails`:

Field|
---|---
`baseURL`|Joined to the front of every address as a string, so `http://host/api` and `/status` give `http://host/api/status`.
`authMethod`|`Basic` sends HTTP Basic auth. Anything else, usually `None`, sends none.
`username`, `password`|For `Basic`. Both must be present, or the driver reports `CONF`.

## Reads

Each poll GETs `baseURL + address` for every address in it at once,
with `Accept: */*`. A `200` reply's body goes to the Edge Agent as it
is, and the agent parses it with the device's payload format (JSON,
XML and so on) as it did for the built-in connection.

Reply|What happens|Built-in
---|---|---
`200`|The body is sent as data.|Same.
Any other reply, including `401` and `403`|No data for that address, logged once until it recovers.|No data, logged every time.
No reply (refused, DNS, TLS, timeout)|No data for that address, logged once until it recovers.|No data, logged every time.

A failing address doesn't take the connection down, because a REST
connection often has several endpoints feeding different devices. The
driver reports `AUTH` (every failure was `401` or `403`) or `CONN`
(otherwise) only when every address is failing and none has had a reply
for a whole poll round. A round is the longest time between two polls
of one address, plus a second, because each device has its own poll
timer. Any reply other than `401` or `403`, even a `404`, shows the
server is there. The Edge Agent then marks the devices dead.

After `AUTH` or `CONN` the driver asks again for every failing
address's URL every 5 seconds, all at once, and reports `UP` once any of
them gets a reply other than `401` or `403`.

The driver library has no way for a driver to report a failed poll on
an address's `err` topic (it uses that only for writes), so a failing
address is only logged.

A request gives up after 25 seconds. The built-in waited for ever.
Redirects are followed up to 21 times and gzip and deflate bodies are
decoded, as axios did. TLS trusts the Mozilla CA list, as Node does.

### Pages

An address can hold a page counter, `${n:m}`, with one digit `n` to
start from and one character `m`: a digit to stop before, or a letter
or `_` for no stop number. The driver GETs page `n`, `n+1` and so on,
with everything from the first `${` to the last `}` replaced by the
page number, until a page doesn't give `200`, the stop number is
reached, or 100 pages have been read. The pages must be JSON, and are
joined into one JSON array: the items of each page that is an array,
and any other page as one item.

The built-in's page loop never finished in practice (see the skipped
test in `acs-edge/tests/lib/devices/REST.test.ts`), so this is new
behaviour rather than a copy. No REST connection we know of uses it.

## Writes

The driver takes typed writes, so the Edge Agent reports a written
value only once the driver confirms it. Each write is a POST to
`baseURL + address` with the value alone as JSON (`-2`, `true`,
`"text"`, a DateTime as milliseconds) and `Content-Type:
application/json`. Any `2xx` reply means it was written. NaN and the
infinities can't be JSON and are refused as `CMD`.

The built-in POSTed a body built from every metric on the address and
the device's payload format. A typed write carries one value and
neither of those, so the bodies differ. No REST metric on our clusters
is writable.

## Layout

```
src/main.rs        logging and Driver::run, nothing else
src/lib.rs         the crate root, so the tests can reach the parts
src/addr.rs        addresses and page counters, with unit tests
src/config.rs      connection details and Basic auth, with unit tests
src/read.rs        replies to data, AUTH or CONN, and paging, with unit tests
src/http.rs        the HTTP client
src/handler.rs     the rs-edge-driver Handler, Poller and writes
tests/driver.rs    the driver end to end against a fake Edge Agent and a stub server
```

## Testing

```sh
cargo test
```

The golden-output harness runs the real Edge Agent with this driver and
requires the same Sparkplug output as the built-in REST connection gave,
from runs recorded before ACS 7 removed it. Build the driver, then from `acs-edge`:

```sh
GOLDEN_DRIVER=../edge-rest/target/release/driver GOLDEN_PROTOCOL=REST npx jest tests/golden -t "split driver"
```

`.github/workflows/split-driver-golden.yaml` runs this on every pull
request that touches the driver. See
[Adding a Rust Driver](../docs/development/rust-drivers.md) for the
build and publishing steps.
