# FANUC FOCAS driver

A split driver that reads data from FANUC CNC controls (Series 0i, 16i,
18i, 21i, 30i, 31i, 32i and others) over FOCAS Ethernet, which is the
TCP protocol the control listens for on port 8193.

The driver speaks the FOCAS protocol itself. It does not use FANUC's
`Fwlib32.dll` or `libfwlib32.so`, which FANUC sells under licence and
which cannot go in a public image, so the driver runs on amd64 and arm64
like the other drivers.

The driver is read-only. It never writes to the control.

## The protocol, and how far to trust it

FANUC does not publish the FOCAS wire format. The driver follows the
open protocol analysis in [pyfanuc](https://github.com/diohpix/pyfanuc),
and the request bytes match pyfanuc's worked examples (see the tests in
`src/protocol.rs`). The fake control in this directory was written from
the same analysis, so the tests prove that the driver and the fake
control agree, not that the driver reads a real machine correctly.

Before you rely on it, run it against one real control and compare a
few values with the control's own screens. The reads that need the
closest check are listed under [Known gaps](#known-gaps).

## Connection details

| Field     | Default | Meaning                                                  |
|-----------|---------|----------------------------------------------------------|
| `host`    |         | The control's IP address or hostname. Required.          |
| `port`    | 8193    | The FOCAS port, set on the control's Ethernet settings.  |
| `timeout` | 5000    | How long, in ms, to wait to connect and for each answer. |

The control must have its embedded Ethernet port (or a FOCAS Ethernet
board) set up with FOCAS enabled. A control accepts only a few FOCAS
sessions at once, often 5 to 20 depending on the model, and the driver
uses one.

## Addresses

Each address is one read from the control. Every read answers with a
JSON object, so set the device's payload format to **JSON** and put a
JSONPath in each metric's path to pick the value out. One address can
feed several metrics, which means one read per poll for all of them.

| Address | Answer | Example path |
|---|---|---|
| `sysinfo` | `{"cnc_type": "31", "mt_type": "M", "series": "G4A1", "version": "14.0", "axes": 3, "max_axes": 8}` | `$.series` |
| `status` | `{"auto", "run", "motion", "mstb", "emergency", "alarm", "edit"}`, each a number | `$.run` |
| `alarm` | `{"active": true, "bits": 2}` | `$.active` |
| `program` | `{"running": 1234, "main": 1234}`, the O numbers | `$.running` |
| `speeds` | `{"feed": 500.0, "spindle": 1200.0}`, actual feed rate and spindle speed | `$.spindle` |
| `position` | `{"absolute": [...], "relative": [...], "machine": [...], "distance": [...]}`, one number per axis, in axis order | `$.machine[2]` |
| `macro:<n>` | `{"value": 12.345}`, or `null` for an empty variable | `$.value` |
| `param:<n>` | `{"values": [...]}`, one per axis for an axis parameter, otherwise one | `$.values[0]` |
| `param:<n>:<axis>` | `{"values": [v]}` for one axis, counting from 1 | `$.values[0]` |
| `pmc:<area><n>[:<size>]` | `{"value": 1234}`. Area is a letter (G F Y X A R T K C D M N E Z), size is `byte` (the default), `word` or `long` | `$.value` |

The `status` numbers are FANUC's codes. For a Series 16 or 31 control:

- `auto`: 0 MDI, 1 MEM, 3 EDIT, 4 HANDLE, 5 JOG, 6 TEACH IN JOG, 7 TEACH IN HANDLE, 8 INC FEED, 9 REFERENCE, 10 REMOTE
- `run`: 0 reset, 1 stop, 2 hold, 3 start, 4 MSTR
- `emergency`: 0 off, 1 emergency stop, 2 reset
- `alarm`: 0 none, 1 alarm, 2 battery low

A read the control refuses, for example a macro variable it does not
have, gives no value and logs a warning once. A connection that drops
sets the connection's status to `CONN` and the driver reconnects.

## Trying it without a machine

`focas-sim` is a fake FANUC control. It plays a three-axis mill on a
60-second loop: 45 seconds cutting (program O1234, spindle at 1200 rpm,
X and Y moving in a circle), 10 seconds idle, and 5 seconds in alarm.
The top of `src/sim.rs` lists every value it gives.

To run it in Docker, from the top of the repository:

```bash
docker buildx build --build-context lib=lib -f edge-focas/Dockerfile.sim -t focas-sim edge-focas
```

```bash
docker run --rm -p 8193:8193 focas-sim
```

Then point a FOCAS connection at your machine's IP address on port
8193, or at `127.0.0.1` for a driver running on the same machine. Set
`RUST_LOG=debug` on the container to log every request.

With Rust installed, `cargo run --bin focas-sim` does the same, and
`cargo run --bin focas-sim 0.0.0.0:9000` picks another port.

## Development

`cargo test` runs the unit tests, the client against the fake control
over TCP (`tests/sim.rs`), and the whole driver against a fake Edge
Agent and the fake control (`tests/driver.rs`). See
[`docs/development/rust-drivers.md`](../docs/development/rust-drivers.md)
for how Rust drivers are built and published.

## Known gaps

- **Untested on a real control.** See above.
- **`status` layout.** pyfanuc only decodes it for Series 16 and 31
  controls. Other series may lay the seven numbers out differently.
- **PMC area codes.** The letter-to-number table comes from FANUC's
  `pmc_rdpmcrng` documentation, not from a capture.
- **Parameter types.** Bit parameters come back as the byte they make
  up, so `$.values[0]` is a number from 0 to 255. Real-number
  parameters are not decoded.
- **Not yet read:** axis names, spindle load, alarm messages, tool
  data and program text. pyfanuc either does not cover them or covers
  them only in part.
