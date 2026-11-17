# edge-udp: UDP split driver

An Edge Agent split driver that listens on a UDP port and passes each
datagram to the Edge Agent as it arrived. The agent parses it with the
device's payload format (Buffer, JSON, Delimited String and so on), as
it does for the built-in UDP connection this driver replaces
(`acs-edge/lib/devices/UDP.ts`). It is written in Rust on
[`lib/rs-edge-driver`](../lib/rs-edge-driver), laid out like
[`edge-test-rs`](../edge-test-rs).

## Connection details

The built-in connection's `UDPConnDetails`, unchanged, so a connection
moves to this driver without editing them:

Field|Meaning
---|---
`port`|The UDP port to listen on. A number, or a string of digits.

A connection with no port, or one outside 0 to 65535, is refused with
status `CONF`. (The built-in connection binds a random port instead,
which no device can know to send to.)

## Addresses

Every datagram goes to the address `""`, the empty string, and only to
it, as with the built-in connection. A metric reads its value from the
datagram with its path and the device's payload format. A metric with
any other address never gets a value, and the driver logs a warning
when no metric has the empty address.

The UDP DriverDef labels the address field "Port", which suggests
typing the port number there. That gives a metric no value, on the
built-in connection and here: leave the address empty.

## What it does

- Binds a `udp4` socket to `0.0.0.0` on the port, without
  `SO_REUSEADDR`, as the built-in does. A port another socket holds is
  reported as `CONN` and retried every 5 seconds until it is free.
- Reads datagrams on one task and publishes each in turn, so they reach
  the Edge Agent in the order the kernel received them.
- Ignores polls, because datagrams arrive when the device sends them.
- Refuses every write with an answer, so the agent does not report a
  value as written. The built-in connection ignored writes and never
  answered them.
- Rebinds the socket after a socket error, where the built-in
  connection closed it for good.

## Bursts and drops

A datagram can be lost in two places, and the driver counts both:

- **In the kernel**, when the socket's receive buffer is full because
  the driver is behind. The driver asks for an 8 MiB buffer. Linux caps
  that at `net.core.rmem_max` and doubles it, so on a stock node
  (`rmem_max` 208 KiB) it gets 416 KiB, twice the built-in
  connection's 208 KiB.
- **In the driver**, when more than 16 MiB of datagrams is waiting to go
  to the Edge Agent because the agent is behind. The driver drops new
  datagrams rather than queue without limit, so a slow agent cannot make
  it run out of memory. This uses `DriverHandle::try_publish` in
  `rs-edge-driver`.

Every 10 seconds in which either count went up, the driver logs a
warning with the counts for that period and the totals. The kernel
count comes from `/proc/net/udp`.

Variable|Default|Meaning
---|---|---
`UDP_RECV_BUFFER`|8388608|Receive buffer to ask for, in bytes.
`UDP_QUEUE_BYTES`|16777216|Most datagram data waiting for the Edge Agent before the driver drops, in bytes.

The edge-agent Helm chart does not pass these to a sidecar today, so
the defaults are what runs.

## Network

A split driver runs as a sidecar in the Edge Agent's pod and shares its
network, so it receives datagrams sent to the pod's IP on the port, as
the agent container did. The chart gives the pod no `hostNetwork`, no
UDP `containerPort` and a Service for MQTT (1883) only, so a device
outside the cluster cannot reach the port without one of those, for
the built-in connection or this driver.

## Building and testing

Cargo runs in Docker if it is not installed. From the repository root:

```sh
docker run --rm -v "$PWD":/w -w /w/edge-udp rust:1.99 cargo test
```

- `src/*.rs` have unit tests for the config, sizes, drop report and
  socket.
- `tests/driver.rs` runs the whole driver over MQTT and a real socket
  against the fake Edge Agent from `rs-edge-driver`'s tests.
- The golden-output harness (`acs-edge/tests/golden`) runs the real
  Edge Agent once with the built-in connection and once with this
  driver, on the `udp-*` fixtures, and requires identical Sparkplug
  output. Its README says how to run it with a Docker-built binary.
- `acs-edge/tests/golden/udp-throughput.test.ts` sends datagrams at
  fixed rates through both and reports loss, order, CPU and memory.
