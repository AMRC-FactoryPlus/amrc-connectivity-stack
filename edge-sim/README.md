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
  UUID, with inline-config and local-directory fallbacks while the
  driver identity story matures.

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
