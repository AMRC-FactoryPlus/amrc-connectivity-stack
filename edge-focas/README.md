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
`src/protocol.rs`). The fake control the tests run against
(`tests/support/fake_cnc.rs`) was written from the same analysis, so
the tests prove that the driver and the fake control agree, not that
the driver reads a real machine correctly.

The meanings of the values have also been checked against FANUC's own
FOCAS2 library documentation (the function reference and `fwlib32.h`
from the FOCAS1/2 developer kit). That documentation covers the library
calls, not the bytes on the wire, so it confirms what each field means
and how numbers are scaled, but not the byte layout. It confirms:

- the `sysinfo` fields (`ODBSYS`) and their order;
- the order of the `status` fields (`ODBST`), which is the same on
  Series 16/18/21, 16i/18i/21i, 0i, 30i/31i/32i and Power Mate i;
- every `status` and `alarm` code listed below;
- the PMC area codes and size codes (`pmc_rdpmcrng`);
- how macro variables are scaled, and that -1 places means empty
  (`cnc_rdmacro`);
- the axis rule for parameters (`cnc_rdparam`): 0 for no axis, 1 and
  up for one axis, -1 for every axis;
- the error codes (`EW_FUNC` 1 to `EW_PROT` 7) named in the logs.

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
| `param:<n>` | `{"values": [v]}` for a parameter with no axis | `$.values[0]` |
| `param:<n>:all` | `{"values": [...]}`, one per axis, for a parameter with an axis | `$.values[1]` |
| `param:<n>:<axis>` | `{"values": [v]}` for one axis, counting from 1 | `$.values[0]` |
| `pmc:<area><n>[:<size>]` | `{"value": 1234}`. Area is a letter (G F Y X A R T K C D M N E Z), size is `byte` (the default, 0 to 255), `word` or `long` (both signed, as FANUC stores them) | `$.value` |

A parameter either has an axis or it does not, and the control refuses
the wrong form with `EW_ATTRIB` (4). The parameter manual for the
control says which kind each parameter is.

The `status` numbers are FANUC's codes, the same on Series 16/18/21,
16i/18i/21i, 0i, 30i/31i/32i and Power Mate i:

- `auto`: 0 MDI, 1 MEM, 2 none, 3 EDIT, 4 HANDLE, 5 JOG, 6 TEACH IN JOG, 7 TEACH IN HANDLE, 8 INC FEED, 9 REFERENCE, 10 REMOTE, 11 TEST
- `run`: 0 reset, 1 stop, 2 hold, 3 start, 4 MSTR (tool retract and recover, or JOG MDI)
- `motion`: 0 none, 1 moving, 2 dwell
- `mstb`: 0 other, 1 FIN
- `emergency`: 0 off, 1 emergency stop, 2 reset
- `alarm`: 0 none, 1 alarm, 2 battery low, 3 fan, 4 power supply warning, 5 FSSB warning, 6 insulation warning, 7 encoder warning, 8 PMC alarm
- `edit`: what the control is doing besides running, such as 1 editing, 2 searching or 7 program restart; the full list depends on the series and is in FANUC's `cnc_statinfo` documentation

The `alarm` address's `bits` are a bit for each kind of alarm, and the
meaning of each bit depends on the series. On a Series 30i, 31i, 32i,
0i-D or Power Mate i-A:

| Bit | Value | Alarm |
|---|---|---|
| 0 | 1 | Parameter switch on (SW) |
| 1 | 2 | Power off needed after a parameter change (PW) |
| 2 | 4 | I/O error (IO) |
| 3 | 8 | Program or operation alarm (PS) |
| 4 | 16 | Overtravel or external data (OT) |
| 5 | 32 | Overheat (OH) |
| 6 | 64 | Servo (SV) |
| 7 | 128 | Data I/O error (SR) |
| 8 | 256 | Macro alarm (MC) |
| 9 | 512 | Spindle (SP) |
| 10 | 1024 | Other (DS) |
| 11 | 2048 | Malfunction prevention (IE) |
| 12 | 4096 | Background program alarm (BG) |
| 13 | 8192 | Synchronisation error (SN) |
| 15 | 32768 | External alarm message (EX) |

On a Series 16i/18i/21i or 0i-A/B/C, bit 4 is overtravel, bit 5
overheat, bit 6 servo, bit 7 system alarm, bit 9 spindle and bit 15 an
external alarm message. `$.active` is true for any alarm on any series.

A read the control refuses, for example a macro variable it does not
have, gives no value and logs a warning once. A connection that drops
sets the connection's status to `CONN` and the driver reconnects.

## Development

`cargo test` runs the unit tests, the client against the fake control
over TCP (`tests/client.rs`), and the whole driver against a fake Edge
Agent and the fake control (`tests/driver.rs`). See
[`docs/development/rust-drivers.md`](../docs/development/rust-drivers.md)
for how Rust drivers are built and published.

## Known gaps

- **Untested on a real control.** See above.
- **Series 15 and 15i.** FANUC lays out `status` differently on these,
  so the driver's `status` fields are wrong for them.
- **Parameter types.** Bit and byte parameters come back as a number
  from 0 to 255, so a signed byte parameter of -1 reads as 255.
  Real-number parameters, which 30i, 0i-D and Power Mate i-A have, are
  not decoded.
- **Not yet read:** axis names, spindle load, alarm messages, tool
  data and program text. pyfanuc either does not cover them or covers
  them only in part.
