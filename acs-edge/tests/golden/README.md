# Golden-output harness

This harness proves that a split driver makes the Edge Agent publish exactly the same Sparkplug output as the built-in connection it replaces. It takes a driver fixture (see `../fixtures/drivers/README.md`), replays the fixture's device input from a fake device, runs the real Edge Agent code against it twice, and compares what the agent publishes.

Every split driver that replaces a built-in connection (REST, MQTT, OPC UA, UDP) must pass it before it is rolled out.

## Running it

From `acs-edge`, after `npm install` there and `npm ci` in `lib/js-edge-driver`:

```sh
npx jest tests/golden
```

On the committed samples this runs:

| Test | What it shows |
|---|---|
| self-check | Each sample through the built-in connection twice. The two runs must match, which shows the harness itself is deterministic. |
| negative check | One sample per protocol with one recorded value changed in the second run. The comparison must fail and name the metric. |
| split driver | Each REST sample through the built-in REST connection and through the reference REST driver. They must match. |
| split driver after service-setup's move | The REST connections of the site in `acs-service-setup/test/rest-move/site.json`, through the built-in connection as the site had them and through the driver as service-setup's move left them (`moved.json`). Both runs must match and send the same credentials. `acs-service-setup/test/rest-move.test.js` checks that the move gives exactly `moved.json`. The UDP connections of `acs-service-setup/test/udp-move/site.json` run the same way with `GOLDEN_PROTOCOL=UDP`, one per payload format, checked by `udp-move.test.js`. |
| in-process driver | One REST sample through a small in-process driver, to cover that path. |

Each run prints the comparison, the CPU time it used and the DDATA messages it sent per device.

To run the private fixtures, cut to their first minute and limited to REST:

```sh
GOLDEN_FIXTURES=<private fixture dir> GOLDEN_DURATION_MS=60000 npx jest tests/golden -t "REST"
```

Fixture names appear in the test names, so this works for any part of a name. Heavy fixtures may need `GOLDEN_INTERVAL_MS` and `GOLDEN_TIME_ALLOWANCE_MS` raised, see "What is compared".

Environment variables:

| Variable | Default | |
|---|---|---|
| `GOLDEN_FIXTURES` | the committed samples | A directory of fixtures to run instead. Use this for the private fixtures, which must never be committed. |
| `GOLDEN_DURATION_MS` | whole fixture | Replay only the first part of each fixture. The private fixtures cover 10 minutes each. |
| `GOLDEN_DRIVER` | the reference REST driver | A command line for the split driver under test, see below. |
| `GOLDEN_PROTOCOL` | `REST` | The fixtures `GOLDEN_DRIVER` is run against. |
| `GOLDEN_INTERVAL_MS` | 200 | How long a fixture's poll interval takes in real time. |
| `GOLDEN_TIME_ALLOWANCE_MS` | 100 | The base timing allowance, see below. |
| `GOLDEN_VERBOSE` | | Let the agent's and driver's console output through. |
| `GOLDEN_STRICT_DDATA` | | Fail a split run that sends more DDATA messages for a device than the built-in connection. |

## Plugging in a real driver

A split driver is given the agent's broker address and its credentials in its environment, as the Helm chart gives a sidecar: `EDGE_MQTT`, `EDGE_USERNAME` and `EDGE_PASSWORD`. The harness does the same. Build the driver, then name its binary:

```sh
GOLDEN_DRIVER=../edge-rest/target/release/driver GOLDEN_PROTOCOL=REST npx jest tests/golden -t "split driver"
```

A Rust driver built with Docker is a Linux binary, so run the harness in a Linux container too, with the repository mounted and `node_modules` kept in volumes so the host's are not touched. For `edge-udp`, from the repository root:

```sh
docker run --rm -v "$PWD":/w -w /w/edge-udp rust:1.99 cargo build --release --locked
docker run --rm -v "$PWD":/w -v acs-edge-nm:/w/acs-edge/node_modules \
    -v jsed-nm:/w/lib/js-edge-driver/node_modules node:22-trixie bash -c '
    cd /w/lib/js-edge-driver && npm ci && cd /w/acs-edge &&
    npm install --save=false --install-links &&
    GOLDEN_DRIVER=/w/edge-udp/target/release/driver GOLDEN_PROTOCOL=UDP \
        npx jest tests/golden -t "split driver"'
```

`GOLDEN_DRIVER` is split on spaces into a command and arguments. Run the binary directly, not through a shell or `npx`, because the harness reads the CPU time of the process it spawned.

From code, `driver.ts` has the two kinds of driver the harness accepts, both a `DriverSpec`:

- `spawned(name, command, args)` runs a command with the driver environment added. This is how real drivers run.
- `in_process(name, start)` calls `start(env)` in the test process and expects back something with `stop()`.

Pass one as `{ b: { driver } }` to `golden()` in `harness.ts`. A run can also take `entry`, a connection entry to run in place of the fixture's (one that is already `Driver` is run as it is), and `secrets`, the values the agent fills `__FPSI__` placeholders from.

## How a run works

`harness.ts` `run_agent()` does one run:

1. The fake device for the fixture's protocol starts (`devices/`), and the connection config is pointed at it.
2. The connection's poll interval is shortened so that the fixture's interval takes `GOLDEN_INTERVAL_MS`. Both runs get the same config.
3. For a split run, the connection is switched to `Driver` with `move_entry()` from `lib/js-service-client/lib/edge-connection.js`, the call service-setup makes when it moves a connection, with the same payload format map (`migrate.ts`).
4. The real `Translator` starts with a stand-in service client (`capture.ts`). It returns the connection as the agent's config and captures what the agent's Sparkplug node publishes. Each message goes through the Sparkplug B encoder the real client uses, and is decoded again for the comparison, so the comparison sees what would go on the wire.
5. For a split run, the agent's own `DriverBroker` listens on a free local port with a temporary password file, and the driver is started against it.
6. The run ends when the fake device has delivered all its input.

The fake devices:

| Protocol | Fake device |
|---|---|
| REST | An HTTP stub. The n-th GET of a path gets the response that was current at fixture time n × interval, so both runs see the same sequence of responses however their poll timing differs. |
| MQTT | An Aedes broker. Once every topic has a subscriber it publishes the recorded messages in order, at their scaled times. |
| OPC UA | A node-opcua server with one variable per node. Security is off on both runs, because no fixture can run a certificate handshake. The connection samples four times per value change, so no change is missed or seen twice. |
| UDP | A sender that waits for the connection to bind its port, then sends each datagram to `127.0.0.1` at its scaled time. |

To add a kind, write a class implementing `FakeDevice` in `devices/device.ts` and add it to `Kinds` in `devices/index.ts`.

## What is compared

`compare.ts` compares the second run with the first:

- **NBIRTH and each device's DBIRTH**: the same metrics by name, with the same types, values and properties, sent the same number of times.
  In both runs alike, a DBIRTH that straight away repeats the same device's DBIRTH, with the same metrics, is left out before counting, because it tells a consumer nothing new. The built-in MQTT connection sends one such repeat per device at startup: the agent's `DeviceConnection.open()` emits `open` at once, and the MQTT client emits it again when it connects. A split driver only reports `UP` once it is connected, so it sends one.
- **DDATA**: for each device and metric, the same sequence of values, with the same types and properties. How values are grouped into DDATA messages is not compared, because it depends on which response arrives first. Each run's DDATA message count per device is reported. A split driver may make the agent send fewer DDATA messages than the built-in connection, because the agent gathers the values a driver sends together (see "Gathering data" in `docs/edge-split.md`). If it sends more for a device the report prints a warning, and with `GOLDEN_STRICT_DDATA=1` the run fails. It is only a warning for now because the Rust drivers' MQTT client writes each message to the socket on its own, so the agent can read the first value of an OPC UA notification before the rest arrive, and the notification comes out as two DDATA in about one run in three.
- **DDEATH**: the same number per device. A death mid-run means the device went away.

**Timing allowance.** A DDATA metric's timestamp is when the agent handled the value, which can never match to the millisecond between two runs. Each timestamp is taken as an offset from the moment the fake device first delivered input in that run, and the two offsets may differ by at most the allowance. The allowance is `GOLDEN_TIME_ALLOWANCE_MS` (100 ms) plus the agent's CPU time per input message in the slower run, because the agent stamps each metric as it works through a message, so one message's metrics are spread over the time it takes to handle it. On the samples that adds 1 to 20 ms, and matching runs differ by under 40 ms. A large XML document read by a hundred metrics costs the agent about 200 ms a poll, which raises the allowance to about 300 ms. Birth timestamps are not compared, because they record when a driver finished starting, not anything about the data. Nothing else has any allowance. Each run prints the allowance it used.

If the agent uses most of a CPU during a run it cannot keep up at the sped-up rate, and its timestamps drift further behind with every poll while the values still match. The report says so when it happens: raise `GOLDEN_INTERVAL_MS`, up to the fixture's own interval for real time.

A failure prints one entry per difference, naming the message, device and metric, with the values side by side and the differing rows marked:

```
DDATA Device_1/Metric_04 (Float): values differ
    #    built-in                                 built-in (2)
    0    242.02642822265625 @ +0.9 ms             249.02642822265625 @ +1.2 ms             <-- value
    1    244.91197204589844 @ +206.2 ms           244.91197204589844 @ +208.3 ms
```

## CPU time

Each run reports CPU time from the first input to the end of input, per input message and per DDATA message, and the startup cost separately.

- **Agent**: `process.cpuUsage()` of the test process. This includes the fake device and the capture, which do the same work in both runs, so compare the two runs rather than reading the figure on its own.
- **Driver**: a spawned driver's own CPU, from `/proc` on Linux or `ps` on macOS, to 10 ms. An in-process driver's CPU is in the agent's figure.

The runs are short, so these figures are indicative. For per-message costs to compare across changes, use the benchmark in `acs-edge/bench/`.

## Limits

- The fixtures are mostly synthetic. See "What synthetic input cannot prove" in the fixtures README: real device timing, real payloads, server quirks and security all still need a check against a live device.
- Writes (DCMD) are not exercised. The fixtures hold device input only.
- Metrics a fixture lists as findings never get a value in either run, so they are compared only in the births.
- The reference REST driver in `rest-driver/` is test support, not a product driver. The product REST driver is ACS-22.
