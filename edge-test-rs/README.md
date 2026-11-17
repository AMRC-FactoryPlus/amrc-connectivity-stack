# edge-test-rs: Rust test driver

An Edge Agent split driver that makes up its data. Each address names
a wave and how to pack its value, and each poll returns the wave's
value at that moment. It is the Rust port of the JS
[`edge-test`](../edge-test) driver and gives the same bytes for the
same address and time, so a Test connection can move to it with no
change to its addresses.

It is also the reference layout for Rust drivers in this repository.
[Adding a Rust Driver](../docs/development/rust-drivers.md) covers the
build, CI and publishing steps.

## Addresses

An address is `func:period:amplitude:packing`, for example
`sin:3000:50:bd`. The period is in milliseconds and the time is
measured from when the driver started.

Part|Values
---|---
`func`|`const` (always the amplitude), `sin` (`a * sin(2π t / p)`), `saw` (`(a / p) * (t % p)`, rising from 0 to the amplitude)
`period`|a number of milliseconds
`amplitude`|a number
`packing`|`bd` or `ld` for an 8-byte double, big or little-endian; `bf` or `lf` for a 4-byte float

The period and amplitude are read as JavaScript's `Number.parseFloat`
reads them, because the JS driver does: leading spaces are skipped and
anything after the number is ignored, so `10abc` is 10. A period of 0
gives NaN for `sin` and `saw`.

An address that does not have four parts, or has an unknown function or
packing, or a period or amplitude with no number at the start, is
rejected and the connection reports `ADDR`. The driver takes no
connection details and accepts any config.

## Layout

```
src/main.rs        logging, clock start and Driver::run, nothing else
src/lib.rs         the crate root, so the tests can reach the parts
src/addr.rs        address parsing, with unit tests
src/wave.rs        the device side: the bytes for an address at a time
src/handler.rs     the rs-edge-driver Handler and a lock-free Poller
tests/driver.rs    the driver end to end against a fake Edge Agent
tests/equivalence.rs   every value checked against the JS driver
```

`tests/driver.rs` borrows the fake Edge Agent from
`lib/rs-edge-driver/tests/common/` with a `#[path]` module, so a driver
needs no broker of its own to test READY, conf, addr, poll and data.

## Matching the JS driver

`tests/equivalence/table.json` holds what the JS driver's own handler
returns for about 3,000 addresses and times, including odd spellings
of numbers, float overflow, subnormals and NaN.
`tests/equivalence/gen-table.mjs` makes it, and `tests/equivalence.rs`
checks every row. To make the table again after changing the JS driver,
run this from the top of the repository:

```bash
docker run --rm -v "$PWD":/w -w /w node:22-alpine node edge-test-rs/tests/equivalence/gen-table.mjs
```

Two details make the bytes match:

- The sine uses the `libm` crate, which is the same fdlibm code V8 uses
  for `Math.sin`. Rust's own `sin` calls the platform's maths library,
  which rounds differently for some inputs, and the table has rows
  that catch it.
- NaN, from a period of 0, is the one value that is not byte-identical.
  JS writes whatever NaN the CPU makes, and amd64 and arm64 set its
  sign bit differently, so the JS driver itself differs between the two.
  The test only requires a NaN there.

The JS driver looks up function and packing names in a plain object,
so names such as `constructor` find JavaScript's own properties and the
address fails later, when it is parsed or polled. This driver rejects
them with `ADDR`.

## Building

```bash
docker run --rm -v "$PWD":/w -w /w/edge-test-rs rust:1.99 cargo test
docker buildx build --build-context lib=lib -t edge-test-rs edge-test-rs
```

Both run from the top of the repository.
