# edge-sim: ACS simulator driver

An Edge Agent driver that replays **cassettes** — JSON recordings of a
device's behaviour — into ACS as if the device were really running.
Built for demonstrators and testing: ACS cannot tell a cassette from a
real machine, so Sparkplug, the historian, datasets and i3X all behave
exactly as in production.

The full format and transport reference is
[docs/cassette-format.md](docs/cassette-format.md). In short:

- A cassette stores channels (tag paths) and sparse samples as
  `[offset_ms, channel, value]`, offsets only, never absolute times.
- Playback is described by `(start_time, rate)`, both parameters of
  the Play command. `start_time` defaults to now; every sample is
  stamped `start_time + offset`. Rate (up to 100x) paces emission and
  never changes stamps, so fast-forwarded data is indistinguishable
  from a real-time run. Virtual time runs ahead of the wall clock at
  rates above 1x by design.
- Transport (load, eject, play, pause, stop, seek, rate) is driven by
  writes to `player:*` addresses, arriving as authorised Factory+
  commands through cmdesc and the edge agent. The "Control simulator
  player" permission's command definition is registered by
  acs-service-setup; bind it to principals per deployment.
- Cassettes are ConfigDB documents (Cassette Application) loaded by
  UUID with `player:load`; switching cassettes by command is the point,
  so there is no inline-config route. The driver holds no credentials:
  it requests the cassette from the edge agent over the local driver
  protocol (`req/cassette` -> `rsp/cassette`) and the agent performs
  the authenticated fetch, scoped to the Cassette app only.
  `CASSETTE_DIR` is a development-only local source.

## Edge Scout

The driver takes part in Edge Scout, so an operator can press Scan in
the origin map editor and pick addresses from a list. A scan lists:

- every channel of the loaded cassette, with its path as both the id
  and the address, `$.value` as the path, and the channel's `type`
  (without its byte order) and `engUnit`. Each `/` in a path makes a
  folder, whose id is the path up to and including that `/`, such as
  `Axes/X/`.
- the player's addresses, in a folder `player:`. The controls are
  writable and the state addresses are read-only.

With no cassette loaded the scan finds nothing, and it is exhaustive,
so the Admin UI asks the operator to load a cassette first. With
samples turned on, each channel's sample is its value at the player's
position. The scan takes no options. `lib/scout.js` is the reference
scouter for JavaScript drivers.

The driver also answers live value reads. A channel reads the value
the cassette is playing for it at the player's position, stamped as the
player stamps that sample, and a readable `player:` address reads the
player's state. A channel with nothing played yet reads null.

## Development

```sh
npm install
npm test
```

`tools/generate-cnc-cassette.js` builds a deterministic five-minute,
1 Hz CNC machining cycle cassette from a CNC origin map CSV:

```sh
node tools/generate-cnc-cassette.js path/to/origin-map.csv > cassettes/cnc-op10.json
```

Generated cassettes are not tracked in git; import them into the
ConfigDB by hand (or serve them with `CASSETTE_DIR`).
