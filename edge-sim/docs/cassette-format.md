# Cassette format (v1)

A cassette is a recording of a device's behaviour that the simulator
driver (`edge-sim`) can replay into ACS as if the device were really
running. It is a single JSON document, normally stored in the ConfigDB
under the *Cassette* Application
(`844c9d80-97ab-4ffc-918c-f4e529411108`) and loaded into the driver by
UUID with the `player:load` command.

## Design rules

- **Offsets, never absolute times.** A cassette stores each sample's
  offset in milliseconds from the start of the recording. It never
  stores wall-clock timestamps. This makes playback repeatable: the
  same cassette can be played today, tomorrow, or on a timeline in the
  future, and always produces the same shape of data.
- **Stamps come from the Play command.** At playback, every sample is
  stamped `start_time + offset`, where `start_time` is an optional
  parameter of Play, defaulting to the moment Play is received. The
  playback rate (1x to 100x) changes how quickly samples are *emitted*,
  never how they are *stamped*, so data recorded at speed is
  indistinguishable from a real-time run.
- **Sparse by design.** A sample only appears when a value changes (or
  when the recording wants to assert it). Channels that never change
  can be recorded once at offset 0. This is the same
  report-by-exception behaviour as Sparkplug itself.

## Document structure

```json
{
  "cassette": {
    "name": "cnc-op10-rough-mill",
    "version": 1,
    "description": "Five-minute roughing cycle on a 3-axis CNC mill",
    "deviceSchema": "CNC",
    "duration_ms": 300000,
    "source": "generated"
  },
  "channels": [
    { "id": 0, "path": "Axes/X/Base_Axis/Position/Actual",
      "type": "DoubleLE", "engUnit": "mm" },
    { "id": 1, "path": "Spindles/S1/Act_Speed",
      "type": "DoubleLE", "engUnit": "rpm" },
    { "id": 2, "path": "Channels/C1/Act_Program_Status",
      "type": "String" }
  ],
  "samples": [
    [0, 2, "Idle"],
    [1000, 0, 12.001],
    [1000, 1, 3000.2]
  ]
}
```

### `cassette` (metadata)

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Human-readable identifier. |
| `version` | yes | Format version. Always `1`. |
| `description` | no | Free text. |
| `deviceSchema` | no | The Factory+ schema the channel paths follow (informational; the edge agent's origin map does the real typing). |
| `duration_ms` | no | Total length. Defaults to the last sample's offset. Playback ends when the position reaches this. |
| `source` | no | Where the recording came from (`generated`, `recorded`, ...). |
| `uuid` | no | Filled in automatically from the ConfigDB object UUID at load. |

### `channels`

Each channel maps a small integer `id` (used in `samples` to keep the
file compact) to a `path`. The path is the driver *address* the edge
agent subscribes to for the matching metric, and by convention is the
metric's tag path from the device's origin map, e.g.
`Axes/X/Base_Axis/Load`. `type` and `engUnit` are informational.

### `samples`

An array of `[offset_ms, channel_id, value]` triples, **sorted by
offset ascending**. Values are plain JSON values (number, string,
boolean). Multiple channels may share an offset. The driver publishes
each sample to the edge agent as a JSON payload:

```json
{ "value": 12.001, "timestamp": 1755518400000 }
```

where `timestamp` is the virtual stamp `start_time + offset_ms`. The
edge agent's existing JSON payload handling extracts the timestamp, so
the stamped data flows through Sparkplug, the historian and datasets
exactly as live data would, with no edge agent changes.

## Transport control

The player is driven entirely through writable metrics on the device,
so every transport action is an authorised Factory+ command (NCMD to
the Command Escalation service, DCMD to the edge agent, forwarded to
the driver). Control addresses contain no slashes because the edge
agent forwards a write on the MQTT topic `cmd/<address>` and only the
first segment survives.

| Address | Write payload | Action |
|---|---|---|
| `player:load` | cassette UUID (string) | Fetch and load the cassette. |
| `player:eject` | anything | Unload. |
| `player:play` | empty, or `{"start_time": <ISO-8601 or ms>, "rate": <0-100>}` | Start or resume. `start_time` defaults to now; `rate` keeps its current value (initially 1). |
| `player:pause` | anything | Halt emission, keep position. |
| `player:stop` | anything | Halt and rewind to 0. |
| `player:seek` | position in ms, or `{"position_ms": n}` | Jump the position. Stamps stay `start_time + offset`, so seeking backwards re-emits earlier stamps (the historian overwrites same-series same-timestamp points). |
| `player:rate` | number 0 to 100 | Change pacing mid-play. 0 pauses. |

Read-only state addresses, published on change: `player:status`
(`EMPTY`, `LOADED`, `PLAYING`, `PAUSED`, `ENDED`), `player:cassette`,
`player:position` (ms, refreshed every second while playing),
`player:rate_actual`, `player:error` (last command error; the
Factory+ alert route is the planned upgrade).

## Storage and loading

Cassettes live in the ConfigDB as entries of the Cassette Application
against objects of the Cassette class
(`64139528-3dbf-4b34-afb5-3a71fc1c4f3b`), both registered by
`acs-service-setup`. The ConfigDB is the source of record and
`player:load` is the only way a cassette reaches the player: switching
cassettes by command is the point of this driver, so there is
deliberately no inline-config route. The driver fetches the entry by
HTTP GET from `CONFIGDB_URL`, sending `CONFIGDB_TOKEN` as a bearer
token. Edge drivers have no Factory+ service identity today, so the
token must be provisioned externally (the krb-keys route is the
intended fix); this is on the critical path for deployment.

For development only, `CASSETTE_DIR` serves `<uuid>.json` files from a
local directory so the driver can run without a cluster. It is checked
before the ConfigDB when set.

## Timeline orchestration

A cassette knows nothing about other cassettes. Coordinated timelines
(machine 2 starts after machine 1 finishes, at any playback rate) are
the orchestrator's job: it computes each playback's `start_time` so the
stamps line up, and stamps its own business objects with the same
virtual times. Consistency comes from a single planner, not from a
shared runtime clock. Virtual time runs ahead of the wall clock at
rates above 1x; this is accepted and dashboards must cater for it.
