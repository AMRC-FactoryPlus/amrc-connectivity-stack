# Golden-output harness

This harness proves that a split driver makes the Edge Agent publish exactly the same Sparkplug output as the built-in connection it replaced. It takes a driver fixture (see `../fixtures/drivers/README.md`), replays the fixture's device input from a fake device, runs the real Edge Agent code with the split driver against it, and compares what the agent publishes with what it published when the built-in connection ran the same fixture.

ACS 7 removed the built-in REST, MQTT, OPC UA and UDP connections from the Edge Agent, so the built-in side is no longer run. Each built-in run was recorded once, before the code was removed, and is committed in `recorded/`. A split driver is compared with those recordings by the same rules as it was compared with a live built-in run. See "Recorded runs" for what a recording holds and what to do without the built-in code.

## Running it

From `acs-edge`, after `npm install` there and `npm ci` in `lib/js-edge-driver`:

```sh
npx jest tests/golden
```

On the committed samples this runs. They are the generated samples in `../fixtures/drivers/samples` and the hand-made ones in `samples/` here: `mqtt-batched` has JSON (Batched) payloads, which the generator can't make, with arrays and single objects on one device and wildcard addresses (`samples/mqtt-batched/make.mjs` writes it). Without `GOLDEN_DRIVER` the driver under test is the reference REST driver, so only the REST cases run.

| Test | What it shows |
|---|---|
| recorded runs | Every comparison below has its recording in `recorded/`. |
| self-check | The first sample of the protocol through the driver twice. The two runs must match, which shows the harness and the driver are deterministic. |
| negative check | The first sample of the protocol with one recorded value changed. The comparison with the recording must fail and name the metric. |
| split driver | Each sample of the protocol through the driver, against the recorded built-in run. They must match. |
| dotted connection name | A REST connection named after a web address, which the move gives a driver id, against the recorded built-in run. |
| split driver after service-setup's move | The connections of the site in `acs-service-setup/test/<rest,mqtt,udp,opcua>-move/site.json` as service-setup's move left them (`moved.json`), through the driver, against the recorded built-in run of each connection as the site had it. `acs-service-setup/test/<protocol>-move.test.js` checks that the move gives exactly `moved.json`. REST and MQTT must also send the same credentials the built-in run did, MQTT over TLS where the connection uses it with the same client id, keep-alive and clean session. OPC UA must log in with the same security and credentials, and a write must reach the server and come back as the published value. |
| OPC UA several devices | The built-in OPC UA connection gave several devices' values to the wrong device. Its recorded run of a two-device connection must not match the driver, which is why the OPC UA move's recording is made one device at a time. |
| split driver DateTime | The built-in OPC UA connection published a DateTime as 0. The driver must publish the date where the recording has 0. |
| in-process driver | One REST sample through a small in-process driver, against the recorded built-in run, to cover that path. |

Each run prints the comparison, the CPU time it used and the DDATA messages it sent per device.

To run the private fixtures, cut to their first minute, with their recordings:

```sh
GOLDEN_FIXTURES=<private fixture dir> GOLDEN_SNAPSHOTS=<private recordings dir> GOLDEN_DURATION_MS=60000 \
    GOLDEN_DRIVER=<driver> GOLDEN_PROTOCOL=REST npx jest tests/golden -t "split driver"
```

The private recordings were made from the first 60,000 ms of each fixture, so `GOLDEN_DURATION_MS` must be 60000. Fixture names appear in the test names, so `-t` works for any part of a name. Heavy fixtures may need `GOLDEN_TIME_ALLOWANCE_MS` raised, see "What is compared".

Environment variables:

| Variable | Default | |
|---|---|---|
| `GOLDEN_FIXTURES` | the committed samples | A directory of fixtures to run instead. Use this for the private fixtures, which must never be committed. |
| `GOLDEN_SNAPSHOTS` | `recorded/` | Where the recorded built-in runs are. Set it with `GOLDEN_FIXTURES`: the private fixtures' recordings must never be committed either. |
| `GOLDEN_DURATION_MS` | whole fixture | Replay only the first part of each fixture. It must match the part the recording covers. |
| `GOLDEN_DRIVER` | the reference REST driver | A command line for the split driver under test, see below. |
| `GOLDEN_PROTOCOL` | `REST` | The fixtures `GOLDEN_DRIVER` is run against. |
| `GOLDEN_INTERVAL_MS` | 200 (400 on CI) | How long a fixture's poll interval takes in real time, for runs not compared with a recording (the self-check). A run compared with a recording goes at the recording's speed, see "Recorded runs". |
| `GOLDEN_TIME_ALLOWANCE_MS` | 100 (250 on CI) | The base timing allowance, see below. |
| `GOLDEN_VERBOSE` | | Let the agent's and driver's console output through. |
| `GOLDEN_STRICT_DDATA` | | Fail a split run that sends more DDATA messages for a device than the recorded built-in run. |

## Recorded runs

`recorded/<key>.json` is one built-in run: the Sparkplug output the agent published, decoded (each birth's metrics, each metric's DDATA values in order with their types and properties), the DDATA message count per device, the credentials the fake device saw, the values written to it, and the agent's CPU time per input message, which sets part of the timing allowance. Each timestamp is kept in fixture milliseconds after the first input. `snapshot.ts` writes and reads the format, and `references.ts` lists every recording the tests compare with and the run that made it.

The built-in connections' output depends on the replay speed, because the number of polls and samples that fall in an interval does. A recording keeps the speed it was made at (a fixture interval every 400 ms of real time, as on CI), and a run compared with it goes at that speed whatever `GOLDEN_INTERVAL_MS` says. Before the built-in code went, every recording was checked by comparing a fresh built-in run with it: all matched.

**A recording can't be re-recorded from this tree**, because the built-in connections are gone. What replaces it:

- **A new sample, or a recording that needs making again.** The recorder is in the git history: `tests/golden/record.test.ts` at the commit that added `recorded/`, which still has the built-in connections. Check that commit out in a worktree, add the sample there, and run `GOLDEN_RECORD=1 GOLDEN_INTERVAL_MS=400 npx jest tests/golden/record.test.ts` (or `GOLDEN_RECORD=check` to compare a fresh built-in run with the existing recordings). Copy the new JSON into `recorded/` here. The Edge Agent's own code at that commit is older than this tree's, so say in the commit what changed in between that could affect the output.
- **A deliberate change to what the agent publishes**, in the agent or in a driver. The recording stays as the built-in's behaviour. Either add a test that pins the difference, as `split driver DateTime` does for the built-in OPC UA connection's DateTime of 0, or edit the recording's JSON by hand in a commit that says what changed and why. Never overwrite a recording with a split driver's run: it would then compare the driver with itself.
- **Private fixtures.** Their recordings were made the same way, from their first 60,000 ms, and are kept with the fixtures, outside the repository.

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

Pass one as `driver` to `run_agent()` in `harness.ts`, and compare the run with its recording: `compare_runs(recorded(key, fixture).run, run)`, with the run at the recording's `speed`. A run can also take `entry`, a connection entry to run in place of the fixture's (one that is already `Driver` is run as it is), and `secrets`, the values the agent fills `__FPSI__` placeholders from. `secure` keeps the connection's security and credentials where the fake device can check them (OPC UA), and `commands` sends the agent DCMDs at fixture times. `golden()` runs a fixture twice, each with a driver, and compares the runs. `merge_runs()` joins runs of one device each into one, which is how the OPC UA move's recording was made.

## How a run works

`harness.ts` `run_agent()` does one run:

1. The fake device for the fixture's protocol starts (`devices/`), and the connection config is pointed at it.
2. The connection's poll interval is shortened so that the fixture's interval takes the recording's interval in real time.
3. A connection not yet on `Driver` is switched to it with `move_entry()` from `lib/js-service-client/lib/edge-connection.js`, the call service-setup makes when it moves a connection, with the same payload format map (`migrate.ts`). A move case's entry is already as service-setup left it, and is run as it is.
4. The real `Translator` starts with a stand-in service client (`capture.ts`). It returns the connection as the agent's config and captures what the agent's Sparkplug node publishes. Each message goes through the Sparkplug B encoder the real client uses, and is decoded again for the comparison, so the comparison sees what would go on the wire.
5. The agent's own `DriverBroker` listens on a free local port with a temporary password file, and the driver is started against it.
6. The run ends when the fake device has delivered all its input.

`compare_runs()` then compares the run with its recording, which `references.ts` `recorded()` loads as a run.

The fake devices:

| Protocol | Fake device |
|---|---|
| REST | An HTTP stub. The n-th GET of a path gets the response that was current at fixture time n × interval, so both runs see the same sequence of responses however their poll timing differs. |
| MQTT | An Aedes broker. Once every topic has a subscriber it publishes the recorded messages in order, at their scaled times. For a connection over `mqtts`, `tls` or `wss` it also serves TLS with a certificate from a CA made with `openssl` for the run, which the agent (Node's default CA list) and the driver (`SSL_CERT_FILE`) trust while it runs. It accepts any credentials and records what each client connected with. A `__NOW_MS-<ms>__` in a payload becomes the send time less `<ms>`, for payloads that carry their own timestamps. |
| OPC UA | A node-opcua server with one variable per node. Security is off on both runs unless the run is `secure`: then the server offers every mode and the policies real connections use, trusts any client certificate, accepts any user, and records each login in `credentials`. Values the connection writes are recorded in `writes`. The connection samples four times per value change, so no change is missed or seen twice. |
| UDP | A sender that waits for the connection to bind its port, then sends each datagram to `127.0.0.1` at its scaled time. |

To add a kind, write a class implementing `FakeDevice` in `devices/device.ts` and add it to `Kinds` in `devices/index.ts`.

## What is compared

`compare.ts` compares the driver's run with the recorded built-in run:

- **NBIRTH and each device's DBIRTH**: the same metrics by name, with the same types, values and properties, sent the same number of times.
  In both runs alike (the recording keeps them apart), a DBIRTH that straight away repeats the same device's DBIRTH, with the same metrics, is left out before counting, because it tells a consumer nothing new. The built-in MQTT connection sent one such repeat per device at startup: the agent's `DeviceConnection.open()` emitted `open` at once, and the MQTT client emitted it again when it connected. A split driver only reports `UP` once it is connected, so it sends one.
- **DDATA**: for each device and metric, the same sequence of values, with the same types and properties. How values are grouped into DDATA messages is not compared, because it depends on which response arrives first. Each run's DDATA message count per device is reported. A split driver may make the agent send fewer DDATA messages than the built-in connection, because the agent gathers the values a driver sends together (see "Gathering data" in `docs/edge-split.md`). If it sends more for a device the report prints a warning, and with `GOLDEN_STRICT_DDATA=1` the run fails. It is only a warning for now because the Rust drivers' MQTT client writes each message to the socket on its own, so the agent can read the first value of an OPC UA notification before the rest arrive, and the notification comes out as two DDATA in about one run in three.
- **DDEATH**: the same number per device. A death mid-run means the device went away.

**Timing allowance.** A DDATA metric's timestamp is when the agent handled the value, which can never match to the millisecond between two runs, recorded or not. Each timestamp is taken as an offset from the moment the fake device first delivered input in that run, and the two offsets may differ by at most the allowance. The allowance is `GOLDEN_TIME_ALLOWANCE_MS` (100 ms) plus the agent's CPU time per input message in the slower run (for the recording, as measured when it was made), because the agent stamps each metric as it works through a message, so one message's metrics are spread over the time it takes to handle it. On the samples that adds 1 to 20 ms, and matching runs differ by under 40 ms. A large XML document read by a hundred metrics costs the agent about 200 ms a poll, which raises the allowance to about 300 ms. Birth timestamps are not compared, because they record when a driver finished starting, not anything about the data. Nothing else has any allowance. Each run prints the allowance it used.

If the agent uses most of a CPU during a run it cannot keep up at the sped-up rate, and its timestamps drift further behind with every poll while the values still match. The report says so when it happens. A run compared with a recording goes at the recording's speed, so raise `GOLDEN_TIME_ALLOWANCE_MS` instead, or give the run a less busy machine.

A failure prints one entry per difference, naming the message, device and metric, with the values side by side and the differing rows marked:

```
DDATA Device_1/Metric_04 (Float): values differ
    #    recorded built-in                        split (edge-rest)
    0    242.02642822265625 @ +0.9 ms             249.02642822265625 @ +1.2 ms             <-- value
    1    244.91197204589844 @ +206.2 ms           244.91197204589844 @ +208.3 ms
```

## CPU time

Each run reports CPU time from the first input to the end of input, per input message and per DDATA message, and the startup cost separately.

- **Agent**: `process.cpuUsage()` of the test process. This includes the fake device and the capture, which do the same work in every run, so compare runs rather than reading the figure on its own. A recording's figure was measured on the machine that made it.
- **Driver**: a spawned driver's own CPU, from `/proc` on Linux or `ps` on macOS, to 10 ms. An in-process driver's CPU is in the agent's figure.

The runs are short, so these figures are indicative. For per-message costs to compare across changes, use the benchmark in `acs-edge/bench/`.

## Limits

- The fixtures are mostly synthetic. See "What synthetic input cannot prove" in the fixtures README: real device timing, real payloads, server quirks and security all still need a check against a live device.
- Writes (DCMD) are exercised only by the OPC UA move cases. The fixtures hold device input only.
- Metrics a fixture lists as findings never get a value in either run, so they are compared only in the births.
- The reference REST driver in `rest-driver/` is test support, not a product driver. The product REST driver is `edge-rest`.
- A recording is the built-in connection's behaviour, bugs included. Where a driver deliberately differs, a test pins the difference (DateTime, several OPC UA devices).
