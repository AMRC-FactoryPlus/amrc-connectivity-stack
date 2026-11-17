# Edge Agent CPU benchmark

This benchmark measures how much CPU time the Edge Agent spends on each
message a connection delivers, for each payload format. It runs on a
laptop with no broker and no cluster, and a full run takes about 100
seconds. Use `--rounds 5` for a quicker run.

It drives the real Edge Agent code: `Device._handleData` parses the
payload, `SparkplugNode` builds the DDATA, and the service client's
`BasicSparkplugNode` protobuf-encodes it. Only the MQTT connection to
the Factory+ broker is fake, and it just counts the DDATA it is given.
So a change to parsing, metric handling or Sparkplug encoding shows up
here.

## Run it

```sh
cd acs-edge
npm install
npm run bench
```

`npm run bench` compiles the agent code the benchmark needs into
`node_modules/.cache/edge-bench` (so it never mixes with the real
`build/`), then runs `bench/run.mjs` with `--expose-gc`. The results
go to `bench/results-latest.json`, which git ignores.

To compare a change against `dev`, run the benchmark on `dev` first and
keep the results, then run it on your branch with `--compare`:

```sh
git switch dev
npm run bench -- --out bench/results-dev.json
git switch my-branch
npm run bench -- --compare bench/results-dev.json
```

Always compare two runs from the same machine. `bench/baseline.json` is
the run from the pull request that added this benchmark. It is there to
show the shape of the numbers, and its `machine` field says what it ran
on, so do not compare a run from another machine against it.

Options:

| Option | Default | Meaning |
|---|---|---|
| `--mode` | `inproc,driver` | Which modes to run (see below). |
| `--cases` | all | Comma-separated case names, for example `json-10,xml-100`. |
| `--rounds` | 7 | Timed rounds per case. Each figure is the median. |
| `--round-ms` | 500 | Roughly how long one round takes. |
| `--warmup-ms` | 500 | Warm-up per case before timing. |
| `--out` | `bench/results-latest.json` | Where to write the results. |
| `--compare` | none | A results file to compare against. Adds a "vs baseline" column. |

## The two modes

- **inproc** hands each payload to the connection's `data` event, as a
  built-in connection such as MQTT does. This is the cost of parsing
  and publishing alone.
- **driver** sends each payload from a stub split driver
  (`driver-stub.mjs`) running in a child process, through the agent's
  in-process Aedes broker (`DriverBroker`) and `DriverConnection`, as a
  split driver does. The stub runs in its own process so that only the
  agent's CPU is counted. The difference between the two modes is the
  cost of the broker hop.

In both modes one device holds every metric of a case on a single
address, so one message carries a value for each metric and produces
one DDATA. Every message changes every value, so the agent's "has it
changed" check never skips a metric.

## The cases

| Case | Payload |
|---|---|
| `json-value-1` | `{"value": v, "timestamp": ms}` with no path, the shape `edge-sim` sends and split drivers are expected to send for each address. |
| `json-10`, `json-100`, `json-1000` | Nested JSON. Metric paths look like `$.machine.group3.tag34`, and every fifth one is an object read through `.value`. 60% Double, 20% Int32, 10% Boolean, 10% String. |
| `json-ts-100` | As `json-100`, with `timestamp` and `timestampNs` in the payload. |
| `json-batched-100x10` | JSON (Batched): an array of 10 rows, each with all 100 metrics and its own timestamp. |
| `xml-100` | XML read with XPath paths such as `/machine/group3/tag34/text()`. |
| `delimited-100` | Delimited String, 100 comma-separated fields. |
| `buffer-100` | Buffer, 100 big-endian 4-byte slots (Float, Int32, UInt16 and bit-addressed Boolean). |

`cases.mjs` builds the metric configs and payloads. Add a case there.

## Reading the numbers

| Column | Meaning |
|---|---|
| CPU us/msg | CPU time (user plus system) the agent process spends per message, in microseconds. This is the main figure. |
| us/metric | CPU us/msg divided by the number of metrics in the message. If this grows with the metric count, the cost per message grows faster than the payload. |
| msg/s | Messages per second the agent kept up with. This is wall-clock time, so other load on the machine affects it more than CPU time. |
| spread | The gap between the fastest and slowest round as a percentage of the median. |
| vs baseline | The change in CPU us/msg against the `--compare` file. |

After the table, "Broker hop" is driver CPU minus inproc CPU for each
case. It is only meaningful for small payloads, where it is about 4 us
for a one-value message and about 10 us for 10 metrics. For large
payloads the two modes differ by up to about 10% either way, because
the socket breaks the work up differently, so the hop is lost in the
parsing cost and can come out negative.

To turn a figure into the load on a real agent, multiply CPU us/msg by
the message rate. For example, 100 messages a second at 4,000 us each
is 0.4 s of CPU every second, which Kubernetes reports as 400m.

## Getting steady numbers

Two runs on the same machine usually agree within about 5% on every
case, even on a busy laptop. The "spread" column is often wider than
that, because it shows the single worst round, which the median
ignores. To keep runs steady:

- Run on a quiet machine. A busy machine moves work onto slower cores,
  which changes CPU time as well as wall time.
- Keep `--expose-gc`, which `npm run bench` adds. It runs a full garbage
  collection before each round so every round starts from the same
  heap.
- Each case runs in its own worker process, so V8 compiles the parsing
  code for that one format, as in an agent whose connections all use
  one format. With every case in one process the small cases came out
  up to 40% slower in some runs and not others.
- The benchmark runs round 1 of every case, then round 2 of every case,
  and so on. A burst of load from something else then spoils one round
  of several cases, which the median drops, instead of every round of
  one case.

## Files

| File | Purpose |
|---|---|
| `run.mjs` | Starts a worker per case, asks for the rounds, prints the table and writes the results file. |
| `worker.mjs` | Runs one case in its own process: sets up both modes, warms up and times each round. |
| `cases.mjs` | Metric configs and payload generators for each case. |
| `harness.mjs` | Builds the real `SparkplugNode` and `Device` with a fake MQTT connection. |
| `driver-stub.mjs` | The stub split driver for driver mode. |
| `build.mjs` | Compiles the agent code the benchmark imports, using `tsconfig.json`. |
| `tsconfig.json` | Lists the agent files to compile and where the output goes. |
| `baseline.json` | The run recorded when the benchmark was added. |
