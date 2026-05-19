# Plan: Reactive pipeline + diff-driven incremental ObjectTree refresh

Option E from the design discussion on 2026-05-13/14. Replaces the
merged-trigger + full-rebuild loop in `lib/refresh.ts` with a reactive
pipeline whose emissions are diffed against the previous snapshot, so the
tree is mutated in place per-device instead of rebuilt wholesale.

## Goal

Tree topology becomes a pure function of:

- the set of devices in the Device class,
- each device's DeviceInformation and Info config,
- each schema's ConfigSchema and Info config.

UNS-discovered composition nodes survive config-driven updates (today they
are silently dropped on every snapshot swap; see `object-tree.ts:122-130`).

## Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ConfigDB notify-v2 (rx-client)                   │
│                                                                     │
│  watch_members(DEVICE_CLASS)  ──┐                                   │
│                                 │  switchMap                        │
│  watch_config(DevInfo, uuid)  ──┼─→ combineLatest per device        │
│  watch_config(Info,    uuid)  ──┘    │                              │
│                                      │ collect Schema_UUIDs         │
│                                      ▼                              │
│  watch_config(ConfigSchema, s)  ─┐                                  │
│  watch_config(Info,         s)  ─┴─→ combineLatest per schema       │
│                                      │                              │
│                                      ▼                              │
│       Emission = { devices: Map<uuid, {devInfo,info}>,              │
│                    schemas: Map<uuid, {schema,info}> }              │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
                ┌────────────────────┐       keeps prev emission,
                │  Diff dispatcher   │ ────  classifies each change
                └─────────┬──────────┘       (added / removed / changed)
                          │
   ┌──────────────┬───────┴───────┬───────────────────┬─────────────┐
   ▼              ▼               ▼                   ▼             ▼
 addDevice  removeDevice  replaceDeviceSubtree  updateDeviceName  ObjectType
                │                  │                              add/remove
         cleanup orphan      preserves                              /update
         ISA-95 ancestors   source:"uns"
                            descendants
   │              │               │                   │             │
   └──────────────┴───────┬───────┴───────────────────┴─────────────┘
                          │   synchronous, no awaits between writes
                          ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                ObjectTree live snapshot                     │
   │                                                             │
   │   objects:   Map<elementId, I3xObject { …, source }>        │
   │   children:  Map<parentId, Set<childId>>                    │
   │   types:     Map<schemaUuid, I3xObjectType>                 │
   │   metric:    Map<leafId, MetricMeta>                        │
   │                                                             │
   └──────▲────────────────────────────────────────▲─────────────┘
          │ mutates in place                       │ reads
          │ (tags new nodes source:"uns")          │
          │                                        │
   ┌──────┴───────────┐                  ┌─────────┴─────────┐
   │   ValueCache     │                  │   API readers     │
   │   onUnsMessage → │                  │   /objects, /value│
   │   addComposition │                  │   /related, /list │
   │   FromUns        │                  │                   │
   └──────▲───────────┘                  └───────────────────┘
          │
   ┌──────┴───────────┐
   │  MQTT UNS/v1/#   │
   └──────────────────┘
```

### Differences from today's flow

| | Today | Option E |
|---|---|---|
| Trigger | `merge(watch_members, search_app×3)` — fires on any DevInfo/Info/Schema entry change anywhere | Per-config watches, fan-out per device + per referenced schema — fires only when something the tree depends on changes |
| Build | Full `loadDevices` HTTP fetch on every trigger | No HTTP on emission; data already in hand from the pipeline |
| Mutation | Build new snapshot off to the side, atomic swap | Diff vs prev emission, dispatch per-device mutation methods, in-place on the live snapshot |
| UNS-discovered nodes | Dropped on every swap, re-created by next UNS message per topic | Tagged `source:"uns"`, preserved across config-driven updates |
| RAG | Rebuilt in full per refresh | Same (Phase 4 incremental deferred) |

## Phasing

Each phase is independently shippable. Stop after any phase if the benefit
is enough.

### Phase 1 — Reactive pipeline replaces merged trigger

No behaviour change to the tree itself; just changes how rebuilds are
triggered and what data they consume.

- Replace `refresh.ts` with a pipeline that subscribes to:
  - `cdb.watch_members(DEVICE_CLASS_UUID)` → Set of device UUIDs
  - For each device UUID (via `switchMap` + `combineLatest`):
    `cdb.watch_config(DEVICE_INFORMATION_APP_UUID, uuid)` and
    `cdb.watch_config(INFO_APP_UUID, uuid)`
  - Schema UUIDs collected from each emitted DeviceInformation originMap →
    for each schema: `cdb.watch_config(CONFIG_SCHEMA_APP_UUID, uuid)` and
    `cdb.watch_config(INFO_APP_UUID, uuid)`
- **Wrap per-config subscriptions in `rxx.cacheSeq` keyed by `(app, obj)`**
  so subscribers to the same `watch_config(app, uuid)` URL share one
  underlying WATCH. This stops `switchMap` from re-sending every
  per-device WATCH when the device set changes (e.g. one device added →
  1 new WATCH, not 200).
- Each emission is a complete `{ devices: Map<uuid, {devInfo, info}>,
  schemas: Map<uuid, {schema, info}> }`.
- Refactor `loadDevices()` to accept pre-fetched configs rather than
  calling `get_config` itself. Keep the HTTP path only for the initial
  bootstrap in `init()`.
- Each emission still triggers a full snapshot rebuild and swap (same as
  today). RAG rebuild unchanged.

**Outcome:** spurious rebuilds from unrelated Info/ConfigSchema entries
stop. Per-rebuild cost is unchanged but rebuild frequency drops because
the pipeline only emits when something the tree depends on actually
changed.

### Phase 2 — Mark node origin (config vs UNS) and stop dropping UNS nodes on swap

Prerequisite for Phase 3, but also a standalone fix for the documented
UNS-drop race (`object-tree.ts:122-130`).

- Add `source: "config" | "uns"` to `I3xObject` (internal field, not
  serialised on the wire).
- `buildTreeFromOriginMap` and `loadDevices` mark nodes `source: "config"`.
- `addCompositionFromUns` marks new nodes `source: "uns"`.
- In the snapshot-swap path, copy `source: "uns"` nodes from the old
  snapshot into the new one (parent must exist in the new snapshot;
  orphans drop).

**Outcome:** the documented race goes away. Tree still rebuilds in full
per emission.

### Phase 3 — Diff each emission and dispatch to fast-path mutations

The core of option E.

- Keep the previous emission in memory inside the pipeline.
- On each new emission, compute diff:
  - **Device set:** added/removed UUIDs (set difference)
  - **Per device:** `devInfo` changed (immutable equality via `imm.is`),
    `info.name` changed
  - **Per schema:** `schema` changed, `info.name` changed
  - **Schema set:** schemas no longer referenced by any device → remove
    ObjectType
- Dispatch each change type to a dedicated mutation method on `ObjectTree`:
  - `addDevice(uuid, devInfo, info, isa95Segments)` — builds device +
    buildTreeFromOriginMap into the live snapshot
  - `removeDevice(uuid)` — removes device + descendants, then walks up
    cleaning orphan ISA-95 ancestors
  - `replaceDeviceSubtree(uuid, devInfo, info, isa95Segments)` — removes
    device's config-sourced subtree, rebuilds it from new originMap,
    preserves `source: "uns"` descendants whose parents survive
  - `updateDeviceName(uuid, displayName)`
  - `addObjectType(uuid, schema, info)` / `removeObjectType(uuid)` /
    `updateObjectType(uuid, schema, info)`
- Mutations apply **synchronously** to the live snapshot (no awaits between
  writes), preserving the existing "readers between event-loop turns see
  consistent state" guarantee. The pipeline provides all configs upfront
  so no fetches happen during apply.
- Drop the snapshot-swap path for pipeline-driven updates. Keep the
  swap-based bootstrap in `init()`.
- Fallback: if a mutation throws, log and run a full rebuild from the
  current pipeline emission. Better to recover than stay broken.

**Outcome:** common case (one device edited) costs one device worth of
work instead of `2(N+M)` HTTP-free reads + a full graph rebuild.

### Phase 4 — Incremental RAG updates

Only if profiling shows full RAG rebuild on each mutation is a hot path.
Likely skip — `nodeCount` is bounded by tree size and the in-memory
rebuild is cheap. Defer until measured.

## Key files

- `acs-i3x/lib/refresh.ts` — rewritten as the reactive pipeline (or rename
  to `pipeline.ts`)
- `acs-i3x/lib/object-tree.ts` — adds `source` field, the new mutation
  methods, ISA-95 orphan cleanup, source-preserving build helper
- `acs-i3x/lib/value-cache.ts` — `addCompositionFromUns` tags nodes with
  `source: "uns"`
- `acs-i3x/bin/api.ts` — wires the new pipeline; bootstrap path simplified
- `acs-i3x/test/` — new tests for: diff dispatch (every change type),
  UNS-node preservation across config update, ISA-95 orphan cleanup,
  fallback on mutation error

## Architectural decisions worth flagging

- **In-place mutation vs per-device sub-snapshot swap.** In-place is
  simpler and Node's single-threaded model gives the atomicity we need so
  long as no mutation `await`s mid-write. Going to in-place mutation.
- **`source` flag vs parallel sets.** Flag on each `I3xObject` — one less
  map to keep in sync.
- **Initial bootstrap.** Keep the existing `init()` HTTP-fetch path.
  Pipeline-first bootstrap couples startup to notify latency; not worth
  it.
- **Many persistent watches are cheap.** notify-v2 multiplexes all WATCH
  requests over a single shared WebSocket (`notify-v2.js:93-106`), and
  with the Phase 1 `cacheSeq` wrapper concurrent subscribers to the same
  `(app, obj)` share one underlying WATCH. So 2N + 2M routing entries on
  both ends of one WS, not 2N + 2M connections.

## Scaling notes (100+ devices)

For N=100 devices and ~20 unique schemas:

| Axis | Value | Verdict |
|---|---|---|
| Concurrent WATCH entries | 2×100 + 2×20 + 1 ≈ 240 | Cheap — multiplexed over one WS |
| Cold-start emissions | 240 initial 201s, then 1 pipeline emission | One-off burst; same order of work as today's bootstrap |
| Steady-state emission rate | Only when an operator edits config | Bounded by human edit rate |
| Diff cost per emission | ~240 `imm.is` checks | Microseconds |
| Tree memory (objects) | 100 × ~200 metric leaves ≈ 20k entries | Tens of MB — fine |
| UNS msg rate | ~1000 msgs/sec | The actual hot path — unchanged from today |

The dominant runtime cost is `ValueCache.onUnsMessage` handling the
Sparkplug-derived UNS firehose, and that's independent of this plan.

Where Option E would start to wobble is more like 1000+ devices or a UNS
firehose >10k msgs/sec — at which point the bottleneck is
`ValueCache.onUnsMessage` and the SSE listener fan-out, not the
ConfigDB-driven pipeline.

## Risks / open questions

- **`switchMap` churn on device-set change** (mitigated by the Phase 1
  `cacheSeq` wrap; verify the wrap actually dedupes by writing a test that
  adds a device and asserts WATCH count goes up by 1, not 2N).
- **Cold-start latency.** `combineLatest` only emits once every input has
  fired. With 240 watches, we wait for 240 round-trips (pipelined over one
  WS) before the first pipeline emission. Likely sub-second on a healthy
  cluster, but worth measuring — and the HTTP `init()` bootstrap should
  populate the tree *before* the pipeline takes over so reads aren't
  blocked.
- **Reconnect storms.** If the WS drops, all 240 watches re-subscribe with
  new UUIDs and each gets a 201. Packet burst, not connection burst. If
  this turns out to cause visible mutation thrash, add `rx.debounceTime`
  to the pipeline output (200–500ms).
- **Mutation atomicity holes.** Every mutation method must complete
  without an `await`. Easy to regress; an eslint rule or a `// no-await`
  comment block helps.
- **ISA-95 orphan cleanup edge cases.** A node that is the only child of
  its ISA-95 parent must walk all the way up; meanwhile UNS messages may
  have placed a different device under the same ancestor. Cleanup must
  check `children.get(parent).size === 0`, not "this was the last
  config-sourced child".
- **`replaceDeviceSubtree` preservation rules.** What counts as "the same
  node" between old and new DeviceInformation? Probably by elementId
  (Instance_UUIDs are deterministic).
- **Schema reference counting.** Removing an ObjectType when no device
  references it requires tracking schema → device refcount. Worth it;
  avoids stale types in `/objecttypes`.

## Out of scope

- API surface changes
- L4 (elementId / Instance_UUID unification) — separate concern
- Subscription-stream changes — `ValueCache.listeners` works at the
  leaf-elementId level and is independent of how the tree refreshes
- RAG incremental updates (Phase 4 deferred)
