# edge-rest: REST split driver

An Edge Agent split driver for HTTP devices, written in Rust on
[`lib/rs-edge-driver`](../lib/rs-edge-driver). It replaces the Edge
Agent's built-in REST connection (`acs-edge/lib/devices/REST.ts`) and
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
`baseURL`|Joined to the front of every address as a string, so `http://host/api` and `/status` give `http://host/api/status`. It must be an `http` or `https` URL, or empty or just `http://` or `https://` when each address carries the rest, or the driver reports `CONF`. The built-in accepted anything, and axios sent each request without a host to `http://localhost:80`, the Edge Agent's own pod.
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
`200` with a body over 16 MiB less 64 KiB|No data for that address, logged once until it recovers.|Sent to the agent.
Any other reply, including `401` and `403`|No data for that address, logged once until it recovers.|No data, logged every time.
No reply (refused, DNS, TLS, timeout)|No data for that address, logged once until it recovers.|No data, logged every time.

A failing address doesn't take the connection down, because a REST
connection often has several endpoints feeding different devices. The
driver reports `AUTH` (every failure was `401` or `403`) or `CONN`
(otherwise) only when every address is failing and none has had a reply
for a whole poll round. A round is the longest time between two polls
of one address, plus a second, because each device has its own poll
timer. Only the addresses in the Edge Agent's current address map
count, however rarely each is polled, and one not yet polled counts as
working. Any reply other than `401` or `403`, even a `404`, shows the
server is there. The Edge Agent then marks the devices dead.

After `AUTH` or `CONN` the driver asks again for every failing
address's URL every 5 seconds, all at once, and reports `UP` once any of
them gets a reply other than `401` or `403`. If the address map changes
meanwhile, only the new map's addresses are asked for, and an address
new to the map brings the connection up straight away so it can be
tried.

An address that doesn't make an `http` or `https` URL with the base
URL gets no data and is logged once, but doesn't count as failing.

A body is limited to 16 MiB less 64 KiB because the driver library's
MQTT client refuses a packet over 16 MiB with an error that ends its
session with the Edge Agent, so one oversized reply would drop every
address's data on every poll. The body is read in chunks and abandoned
at the limit.

The driver library has no way for a driver to report a failed poll on
an address's `err` topic (it uses that only for writes), so a failing
address is only logged.

A read gives up 25 seconds after it starts, all its pages included,
which is under the driver library's 30 second poll timeout, so every
read finishes and counts towards the connection's health. The built-in
waited for ever.
Redirects are followed up to 21 times and gzip and deflate bodies are
decoded, as axios did. TLS trusts the Mozilla CA list, as Node does.

### Pages

An address can hold a page counter, `${n:m}`, with one digit `n` to
start from and one character `m`: a digit to stop before, or a letter
or `_` for no stop number. The driver GETs page `n`, `n+1` and so on,
with everything from the first `${` to the last `}` replaced by the
page number, until a page doesn't give `200`, the stop number is
reached, 100 pages have been read, or the read's 25 seconds are up, in
which case the pages it has are used. The pages must be JSON, and are
joined into one JSON array: the items of each page that is an array,
and any other page as one item. Joined pages over the body limit give
no data.

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
src/read.rs        replies to data or failures, paging, the deadline and size limit, with unit tests
src/health.rs      when failures take the connection down, with unit tests
src/http.rs        the HTTP client, reading bodies up to the limit
src/handler.rs     the rs-edge-driver Handler, Poller and writes
tests/driver.rs    the driver end to end against a fake Edge Agent and a stub server
```

## Testing

```sh
cargo test
```

The golden-output harness runs the real Edge Agent once with the
built-in REST connection and once with this driver, and requires the
same Sparkplug output. Build the driver, then from `acs-edge`:

```sh
GOLDEN_DRIVER=../edge-rest/target/release/driver GOLDEN_PROTOCOL=REST npx jest tests/golden -t "split driver"
```

`.github/workflows/split-driver-golden.yaml` runs this on every pull
request that touches the driver. See
[Adding a Rust Driver](../docs/development/rust-drivers.md) for the
build and publishing steps.
