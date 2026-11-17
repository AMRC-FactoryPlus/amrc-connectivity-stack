# Driver fixtures

A driver fixture is a saved Edge Agent connection plus the input its device sends over time, in a form a test can replay. The golden-output harness feeds the same fixture through a built-in connection and through the split driver that replaces it, and compares the Sparkplug output. The benchmark replays fixtures to measure Edge Agent CPU per message.

This directory holds the format, a generator that builds fixtures from a real connection config, and a few small anonymised samples that CI checks. Fixtures built from real configs hold real hostnames, topics and device names, so they are kept outside this repository and must never be committed here.

## Layout

One directory per fixture:

```
<fixture>/
  fixture.json      what the fixture is and what it exercises
  connection.json   the Edge Agent connection config
  events.jsonl      the device input, one event per line, in time order
```

`read_fixture()` and `write_fixture()` in `fixture.ts` read and write it.

### fixture.json

| Field | Meaning |
|---|---|
| `format`, `version` | Always `"acs-driver-fixture"` and `1`. |
| `name`, `agent` | The connection name and the Edge Agent it came from. |
| `protocol` | The connection type: `"OPC UA"`, `"MQTT"` or `"REST"`. |
| `payloadFormat`, `delimiter` | How the Edge Agent parses each payload, as the agent resolves them (`delimiter` is `""` when the config has none). |
| `source` | `"synthetic"` (made by the generator) or `"recorded"` (real responses). |
| `seed` | The generator seed. The same config and seed give the same fixture. |
| `duration_ms` | How much time the events cover. |
| `interval_ms` | The MQTT publish interval per topic, or the REST or OPC UA poll interval. |
| `features` | Tags for what the fixture exercises, such as `jsonpath:filter`, `xpath:contains`, `delimited:whole-payload`, `opcua:security:SignAndEncrypt/Basic256Sha256` and `type:Double`. |
| `counts` | Devices, all metrics, read metrics, addresses, events and payload bytes. |
| `findings` | Metrics the fixture cannot drive, and why. See "Findings". |

### connection.json

One `deviceConnections[]` entry from the Edge Agent config (`App.EdgeAgentConfig`), with `devices[].tags[]` as the config holds them. Passwords are `REDACTED`. To load it the way the agent does, wrap it as `{deviceConnections: [connection]}` and pass it to `reHashConf()`.

### events.jsonl

Each line is one event. `t` is milliseconds from the start of the fixture. Replay can scale time to run faster or slower.

**MQTT**: a message the broker delivers at `t`.

```json
{"t": 10, "type": "mqtt", "topic": "sample/topic_03", "payload": "{\"set\":{\"datapoints\":[...]}}"}
```

`payload` is UTF-8 text unless `"encoding": "base64"` is set. The built-in connection hands the agent `{[topic]: Buffer}`.

**REST**: the response a `GET` of `path` returns from `t` until the next event for the same path.

```json
{"t": 0, "type": "http", "path": "/resource_01", "status": 200, "content_type": "application/xml", "body": "<?xml ...>"}
```

`path` is the metric address exactly as configured, so the request URL is `baseURL + path`. A stub server answers each request with the latest event for that path at or before the current fixture time. The built-in connection hands the agent the body as axios gives it: a parsed object for a JSON content type and a string otherwise. `event_payload()` does the same.

**OPC UA**: node values that change at `t`.

```json
{"t": 0, "type": "opcua", "values": {"ns=2;s=Sample/Node_01": {"dataType": "Double", "value": 131.15}}}
```

The first event lists every node, so it also gives the node set and data types a test server needs. Later events list only nodes whose value changed, as a subscription reports them. `dataType` is the OPC UA type the Edge Agent maps the metric's Sparkplug type to (`OPCUADataType` in `typeHandler.ts`). A `DateTime` value is an ISO 8601 string. The built-in connection hands the agent `{[nodeId.toString()]: value}` without parsing.

## The generator

The generator reads a connection config and writes a fixture. For every metric the agent reads (an address and a `GET` method), it builds payloads in which the metric's path points at a value of the metric's type:

- **JSON**: `$`, `.key`, `['key']`, `[n]` and `[?(@.field == 'value')]` are turned back into the objects and arrays they select. A metric with no path gets `{"value": ...}`, which is what the agent reads in that case.
- **XML**: absolute and `//` steps, `*`, `[@attr='v']`, `[Name='v']`, `[Name[contains(text(),'v')]]` and a final `text()`, `node()` or `@attr` are turned back into elements. An element only selected by `*` is named after its id attribute (`componentId` gives `<Component>`).
- **Delimited string**: the payload is the value itself, or the fields joined by the delimiter when paths are field indexes.
- **OPC UA**: one node per node id, with the data type the agent maps the metric's type to.

Values change over time: analogue values follow a sine wave with noise inside the metric's engineering range (if it has one), counts step up and down, booleans and strings change now and then. `Float` values are exact 32-bit floats so they survive Sparkplug encoding. MQTT topics publish every second by default, REST and OPC UA values change at the connection's poll interval.

Each payload is then read back with the Edge Agent's own code: `reHashConf()` and the `Metrics` index build the metrics, and `parseValueFromPayload()` reads each value, as `Device._handleData()` does. A metric only counts as covered if the parser returns the value the payload was built to hold.

### Running it

The generator imports the agent's TypeScript, so compile it first. From `acs-edge`:

```sh
npx tsc -p tests/fixtures/drivers
node --no-warnings --es-module-specifier-resolution=node \
    build/driver-fixtures/tests/fixtures/drivers/generate.js \
    synth <config.json> <out-dir> [options]
```

`<config.json>` is `{"agent": ..., "connection": <deviceConnections entry>}`, or a bare connection.

| Command | Does |
|---|---|
| `synth` | Synthesise a fixture for a real config. |
| `sample` | Pick up to `--max-metrics` metrics that resolve, covering each kind of path and type, rename every host, device, topic, node id and metric, and synthesise a fixture for that. Needs `--kind`. This is how the samples here were made. |
| `record` | Poll each address of a REST connection `--polls` times at its poll interval and save the real responses. It refuses connections that need credentials, so only use it on public APIs. |

| Option | Default | |
|---|---|---|
| `--duration <ms>` | 600000 | Time the events cover. |
| `--mqtt-interval <ms>` | 1000 | MQTT publish interval per topic. |
| `--seed <n>` | 1 | Changes every value. |
| `--verify-events <n>` | 50 | Events per address read back for `synth`. `sample` reads back every event. |
| `--max-metrics <n>` | 12 | Size of a sample. |
| `--kind <name>` | | Sample name: `opcua` and `mqtt-*` pick the address style. |
| `--polls <n>` | 3 | Polls for `record`. |

### Findings

A finding is a metric the fixture cannot drive. Each one names the device, metric, address, path and the problem. Most are problems with the real config, which no device input can fix:

- **Shadowed**: two metrics on one device have the same address and path. The agent's `Metrics` index keeps one per pair, so the other never gets a value.
- **Path the parser cannot satisfy**: for example a delimited-string path on a connection with no delimiter, which the agent uses to index into the payload text.
- **Value read back wrong**: for example an XPath ending in `/@attr`, which makes the agent publish the attribute's markup (` attr="value"`) instead of its value.
- **OPC UA node id that does not round-trip**: the agent keys values by `nodeId.toString()`, so a node id written differently in the config is never matched.

The rest are limits of the generator (a JSONPath wildcard or an XPath function it cannot invert, or a type it does not synthesise). The generator prints every finding and saves them in `fixture.json`.

## Samples

`samples/` holds one small fixture of each kind, cut down from real connections with every host, device, topic, node id and metric renamed. Paths and types are kept. `samples.test.ts` checks that every metric in each one resolves with the agent's parser.

| Sample | Exercises |
|---|---|
| `opcua` | OPC UA, `SignAndEncrypt` with credentials, several types and byte orders |
| `mqtt-json` | MQTT JSON, `$.value` and `[?(@.name=='...')]` filters, many metrics per topic |
| `mqtt-delimited` | MQTT delimited string with no delimiter (the whole payload is the value), two devices reading one topic |
| `rest-json` | REST JSON, array indexes and filters |
| `rest-xml` | REST XML in MTConnect style, `//*[@attr='v']` steps |
| `rest-xml-contains` | REST XML with `[Name[contains(text(),'...')]]` predicates |

## What synthetic input cannot prove

A synthetic fixture shows that a driver turns the same input into the same Sparkplug output as the built-in connection. It cannot show:

- **Real device timing**: bursts, slow or late responses, message order across topics, real MQTT rates and how often OPC UA values change. The intervals here are defaults.
- **Real payloads**: fields the config doesn't read, real sizes, number formatting, odd characters, and endpoints that leave fields out. The carbon intensity API's regional endpoints, for example, return a forecast and no actual value, which only the recorded fixture shows.
- **Server quirks**: what an OPC UA server really reports for a node's data type, status codes, browse names, session limits, reconnects, HTTP errors and redirects, and broker behaviour such as retained messages.
- **Security**: OPC UA certificates and policies (`SignAndEncrypt`, Basic256Sha256, Aes128_Sha256), user credentials, MQTT over TLS and HTTP Basic auth. The fixtures record which of these a connection uses, so a driver test knows to cover it, but nothing here runs a handshake.

Each of these still needs a check against a live device or server before a driver replaces a built-in connection on site.
