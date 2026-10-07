# acs-i3x Technical Design

## Overview

A TypeScript ACS service that implements the i3X (Industrial Information Interoperability eXchange) REST/SSE API specification, translating i3X queries into calls against existing Factory+ services. Read-only. Full spec compliance for all REQUIRED endpoints plus history and SSE streaming.

See [pitch.md](pitch.md) for strategic context and data model mapping.
See [to-improve.md](to-improve.md) for tracked spec deviations and known limitations.

## Project Structure

```
acs-i3x/
├── docs/                      Design notes, pitch, to-improve list
├── bin/
│   └── api.ts                 Entry point (wires everything below)
├── lib/
│   ├── constants.ts           UUIDs, relationship types, version
│   ├── git-version.ts         (generated at build)
│   ├── routes.ts              Route factory → Express app (+ /mcp)
│   ├── api-v1.ts              i3X v1 endpoint router
│   ├── store.ts               SQLite database (node:sqlite)
│   ├── object-tree.ts         Object graph, kept in the database
│   ├── sync.ts                ConfigDB sync engine (ETag searches)
│   ├── value-cache.ts         UNS MQTT → last values in the database
│   ├── history.ts             InfluxDB query translation
│   ├── semaphore.ts           Process-wide cap on Flux queries
│   ├── subscriptions.ts       Subscription manager (SSE + sync)
│   ├── mapping.ts             Factory+ → i3X translation helpers
│   ├── quality.ts             Quality derivation
│   ├── middleware/envelope.ts i3X response envelope
│   ├── rag/i3x-rag.ts         Graph + search index for MCP (opt-in)
│   ├── mcp/                   MCP tools and transport (opt-in)
│   └── types/i3x.ts           i3X request/response types
├── test/                      Jest suites (see Test Strategy)
└── bench/                     Bulk value benchmark against InfluxDB
```

## Entry Point (bin/api.ts)

```
RxClient.init()
    → I3xStore (opens /data/i3x.db)
    → ObjectTree (over the store)
    → ValueCache.init (subscribes to UNS/v1/#)
    → History, SubscriptionManager
    → MCP server + RAG index, only if I3X_MCP_ENABLED=true
    → WebAPI.init({ routes, ping }), api.run()
    → ConfigSync.run (fills the tree from ConfigDB)
```

WebAPI handles the HTTP server, auth middleware and CORS. The routes
factory mounts the i3X v1 router at `/v1/`. `/v1/info` is public (the spec
requires it unauthenticated). Every other route returns 503 until the
object tree is ready: after the first sync, or at once if the database
holds the tree from an earlier run.

## Storage (store.ts)

The namespace and last values do not live on the JS heap. They live in an
embedded SQLite database, opened with the built-in `node:sqlite` module (no
native dependency; its ExperimentalWarning is suppressed). Measured on the
in-memory design, the heap cost about 116 KB per device, which ran a 74,000
device fleet out of memory.

- Path: `I3X_DB_PATH` (default `/data/i3x.db`, a volume in the chart).
- WAL journal, `synchronous=NORMAL`, page cache capped at `I3X_DB_CACHE_MB`
  MiB (default 64).
- The database is a cache of ConfigDB and the UNS. The schema version is in
  `PRAGMA user_version`, with a fingerprint of the namespace settings; on
  any mismatch the tables are dropped and rebuilt, and the next sync fills
  them again. A file that cannot be opened, or is shorter than its header
  says, is deleted (with its WAL) and recreated, with a loud log line.
- Group commit: writes join one open transaction that commits 250 ms after
  the first write, or as soon as it holds 2,000 changed rows. A COMMIT
  costs more than one device's or one UNS message's writes, so this keeps
  the commit rate low, and the size cap keeps each COMMIT short. Nested
  `transaction()` calls are savepoints. The process sees its writes at
  once; a crash loses at most the open batch.
- WAL checkpoints run in a worker thread on its own connection (PASSIVE,
  every 100 ms), not inside a COMMIT on the main thread. SQLite rewinds
  the WAL only once a checkpoint has caught up with every frame, so when
  the WAL passes 64 MiB the writers that can wait (the sync engine,
  background value flushes) hold back until it has. Writers that cannot
  wait (UNS messages that add objects) can still grow it during a burst;
  at 1 GiB the main thread checkpoints itself, a stall but a bound.
- Queued UNS values are written 1,000 per turn of the event loop; a leaf
  read answers from the queue.

## The event loop

node:sqlite is synchronous, so any long loop over the tree holds the
event loop, and with it every other request, MQTT and the UNS. Work that
grows with the fleet runs in small steps and pauses with setImmediate
once 20 ms have passed (`lib/slicer.ts`):

- `GET /objects`, the related routes and composition values stream with
  pauses even when the client keeps up; their rows are read a page at a
  time from a snapshot.
- A composition's components are read by a depth-first walk with indexed
  child pages, not one sorted query.
- History expands compositions to leaves, matches series and writes
  values back in slices.
- ConfigSync's reconcile reads the stored devices a page at a time, and
  the orphan drop works in pages of UNS parents.

Tables:

| Table | Holds |
|---|---|
| `object` | Every i3X object: elementId, parent, type, display name, composition flag, source (`config` or `uns`). `seq` keeps insertion order. |
| `metric_meta` | InfluxDB query metadata per leaf metric. |
| `object_type` | ObjectTypes: display name and JSON schema. |
| `device_schema` | The Schema_UUIDs each device in the tree references. |
| `sync_device`, `sync_schema` | The ConfigDB ETags each device and schema was last built from. |
| `last_value` | The last value of each leaf metric, with the object it is filed under (`anchor`), its device and its source (`uns`, `influx`, or `empty` for an InfluxDB "no data" marker). |
| `meta` | Fingerprint, whether a sync has completed, and when the stored values were last current (`values_current_until`). |

## Measured scale

Measured on 5 October 2026 with a scale harness (outside this repo) that
drives the compiled classes: real ObjectTree, I3xStore, ConfigSync,
ValueCache, History and routes, and the real rx-client NotifyV2 over a real
WebSocket. ConfigDB is a fake in a separate process that answers the
Device class WATCH, the ETag SEARCHes and the config GETs, which i3X makes
through service-client's HTTP stack (got-fetch, `no-cache`). Devices are
synthetic streetlights: 5.3 KB DeviceInformation, 34 config objects and 35
UNS metrics each. Node 22.23 on node:22-alpine, in Docker on an Apple
silicon laptop; 64 MiB page cache, 16 fetches in flight.

| Devices | Cold sync | Peak RSS, cold sync | RSS / heap after sync | RSS / heap, steady (cold / warm start) | Warm restart | Database |
|---|---|---|---|---|---|---|
| 7,300 | 10 s | 270 MiB | 267 / 32 MiB | 267 / 32, 303 / 32 MiB | 0.2 s, 0 GETs | 233 MiB |
| 20,000 | 41 s | 268 MiB | 264 / 40 MiB | 264 / 40, 323 / 37 MiB | 0.3 s, 0 GETs | 599 MiB |
| 44,000 | 157 s | 435 MiB | 428 / 55 MiB | 385 / 55, 386 / 53 MiB | 0.8 s, 0 GETs | 1.2 GiB |
| 74,000 | 346 s | 551 MiB | 477 / 74 MiB | 478 / 74, 450 / 71 MiB | 1.4 s, 0 GETs | 2.0 GiB |

"Steady" is after every UNS metric of every device has arrived once.
A warm restart serves the stored tree at once; the time is to finish
comparing the ETag snapshots. The database size includes last values.
`GET /objects` at 74,000 devices streams 586 MiB in about 4 s and raises
RSS by about 14 MiB. A current-value read of 1,000 leaves known to the
value cache takes about 12 ms and no Flux query. UNS ingest runs at 11,000
to 34,000 messages a second when it creates nodes and 32,000 to 59,000
when it does not, slower as the database outgrows the page cache.

The in-memory design measured about 116 KB of heap per device: 5.1 GB at
44,000 devices and 8.6 GB at 74,000, and it was OOM-killed at 2 to
3.5 GiB.

Most of the RSS above the heap is the SQLite page cache and memory the
allocator keeps after the cold sync's churn; the live heap stays under
75 MiB. The cold-sync peak is V8 letting the heap grow between
collections while 148,000 config bodies are parsed. With
`--max-old-space-size=256` the 74,000-device cold sync peaked at 319 MiB
RSS and settled at 268 MiB, in the same time. The chart does not set it:
with MCP enabled the RAG index alone needs several GB at that size, and
memory limits are set separately. A smaller page cache
(`I3X_DB_CACHE_MB=16`) made the sync slower and saved no memory.

After the fixes from the review of this change, at 74,000 devices with
`--max-old-space-size=384` (the chart's `i3x.maxHeapMB` default, MCP off):
cold sync 371 s, peak RSS 329 MiB; 279 MiB RSS and 74 MiB heap after sync;
277 MiB at steady state (304 MiB after a warm restart, which took 1.9 s
and no GETs). UNS ingest ran at 9,500 messages a second creating nodes and
25,500 without. The cached value of the top ISA-95 level (2.6 million
components, a 300 MiB body) streamed in 33 s, raising RSS by 9 MiB with a
heap peak of 129 MiB. Most of those 33 s was SQLite sorting the components
before the first one was sent, which blocked the event loop; see the next
paragraph and "The event loop" for the walk that replaced it.

With the event-loop work below, at 74,000 devices with
`--max-old-space-size=384` (monitorEventLoopDelay, longest delay):

| | Total time | Longest delay, cold start | Longest delay, warm start |
|---|---|---|---|
| `GET /objects` (586 MiB) | 4.4 s | 33 ms | 38 ms |
| Top ISA-95 level's cached value (300 MiB) | 30 s | 44 ms | 38 ms |
| `POST /objects/value`, 1,000 cached leaves | 15-17 ms | 0 | 0 |
| Initial sync (p99) | 366 s / 1.2 s | 276 ms (41 ms) | 287 ms (240 ms) |
| UNS burst, every metric of the fleet (p99) | 143 s / 89 s | 2.2 s (46 ms) | 560 ms (28 ms) |

Cold sync peaked at 306 MiB RSS; steady state was 277 MiB (331 MiB after
a warm restart) with 74 MiB of heap. The WAL peaked at 1.5 GB during the
cold burst and 77 MB warm. The long delays left are background work: the
WAL hard cap's checkpoints on the main thread during a sustained burst of
writes that cannot wait (a cold start that adds half a million UNS objects
at full speed; the 2.2 s also includes the harness's own final flush), and
parsing the three ETag SEARCH snapshots (about 7 MB of JSON each) when the
sync starts.

## Core Components

### object-tree.ts

The i3X object graph, read and written with synchronous SQL. Every public
method keeps the name, signature and return shape it had when the tree was
a set of in-memory Maps, and objects come back field for field as before.
List order is insertion order, as Map iteration was.

Built from ConfigDB only; the Directory is not used. A device's
DeviceInformation `originMap` gives its type (Schema_UUID), its ISA-95
hierarchy and its metric tree; its Info config gives its display name.

- `addDevice`, `replaceDeviceSubtree`, `removeDevice`, `updateDeviceName`,
  `addObjectType`, `updateObjectType`, `removeObjectType`: one change each,
  in one transaction.
- ISA-95 levels (Enterprise → Work Unit) have deterministic v5 UUIDs,
  are shared by every device under them, and are removed with the last
  device under them.
- `addCompositionFromUns` adds nodes a UNS message names but the config
  does not (source `uns`). `replaceDeviceSubtree` keeps them while their
  parent survives; a node the new config defines becomes `config`.
- `refreshFromSnapshot` makes the tree hold exactly a given set of devices
  and schemas, with the same per-device mutations.
- `iterateObjects` reads the tree a page at a time; `GET /objects` streams
  from it instead of building one array. With a file database the pages
  come from one read transaction on a separate read-only connection, so a
  stream sees one consistent view however long the client takes.
- `addCompositionFromUns` adds nothing for a device that is not in the
  tree. `dropOrphans` removes UNS nodes whose parent is gone and empty
  ISA-95 levels; the sync engine runs it on every reconcile.
- `onChange` reports writes; the RAG index uses it to know it is stale.

### sync.ts (ConfigSync)

Keeps the tree in step with ConfigDB with a fixed number of subscriptions,
however many devices there are:

- one notify WATCH of the Device class members;
- one notify SEARCH of `v2/app/:app/etag/` each for the DeviceInformation,
  Info and Schema Applications. Each child of these searches is a config
  entry's ETag, not its body.

When the searches send a full snapshot (at start and after every
reconnect), the stored ETags are compared with it and only the configs that
differ are fetched. A warm restart with no changes fetches nothing. After
that, each child update fetches the one config it names:
DeviceInformation rebuilds the device, Info renames it (or renames an
ObjectType), Schema updates an ObjectType. A device that leaves the Device
class is removed, with its values; an ObjectType no device references any
more is dropped.

Fetches use an uncached ServiceClient (`fplus.uncached()`: the default HTTP
cache keeps every response for ever), at most `I3X_SYNC_CONCURRENCY` (16)
at once and one per device or schema. A config that changes again while
its fetch is in flight is fetched again. Applying a result is synchronous,
so writes never interleave. Failed fetches are retried after 10 s, and the
tree is not marked ready (nor a completed sync recorded) while any fetch
is failing or waiting to be retried. A group commit that fails (a full
disk) rolls back applied changes; the engine then compares everything with
ConfigDB again after the retry delay. Errors while handling an update are
logged and counted, and followed by a reconcile. A cold sync logs progress
every 1,000 devices.

### value-cache.ts

Subscribes to `UNS/v1/#`. On each message:
1. Parses the UNS topic (ISA-95 hierarchy + metric path).
2. Reads the MQTT v5 user properties (InstanceUUIDPath, SchemaUUIDPath).
   A trailing `:` (uns-ingester sends `device:` for a metric directly under
   the device) does not add an empty segment.
3. Adds any new composition nodes to the object tree. A message for a
   device that is not in the tree is dropped.
4. Notifies the subscription manager.
5. Queues the VQT for the `last_value` table, filed under the leaf's parent
   in the tree; queued values are written every 250 ms or 1,000 values,
   and every read flushes first. A failed write keeps the values for the
   next one.

InfluxDB values that History reads on a cache miss are written back
(`recordInfluxValues`), never over a newer UNS value, and serve later
reads of that leaf. A composition read whole from InfluxDB also leaves a
"no data" marker for each leaf InfluxDB had nothing for; once every leaf has
a value or a marker the composition is complete and is built from all its
stored values. Otherwise it is built from UNS values only, and one with no
UNS data falls back to InfluxDB whole.

UNS messages sent while i3X was not listening (down, or disconnected from
MQTT) are lost: they are QoS 0 and not retained. So after a restart or an
MQTT reconnect the stored values are caught up from InfluxDB instead of
being cleared, which made every restart re-read every value (about 24
minutes for a 62,000-device map, against seconds from the cache):

1. While MQTT is connected and the values are trusted, every 5 s and when
   the connection closes, `values_current_until` in the `meta` table
   records the earliest of: when the oldest UNS message not yet written
   arrived, when the last MQTT packet came (a dead link is noticed only by
   the keepalive, up to 90 s later), and when the oldest value dropped
   unwritten after failed writes came. It joins the group commit, so it is
   durable with the values before it.
2. At start and on a reconnect, every stored row (seq up to the current
   maximum) is marked untrusted. Reads skip untrusted rows, so they behave
   exactly as after a clear: InfluxDB answers and its values are kept. A
   UNS message, or a value read from InfluxDB, replaces an untrusted row
   and takes a new seq, so it is trusted.
3. Once MQTT is connected (the subscription is renewed on each connect),
   i3X waits `I3X_CATCHUP_MARGIN_MS` (default 60 s) for the historian to
   write what was published just before, then reads, for the leaves the
   untrusted rows hold, the last point of every series since
   `values_current_until` less the same margin. The margin also covers
   device clocks behind i3X's: InfluxDB filters on the metric timestamp,
   and has no time of arrival. The query is the bulk `last()` read with a
   time-bounded range, using half the bulk concurrency under the shared
   Flux semaphore, a page of devices at a time with pauses for the event
   loop.
4. A point newer than the stored value replaces it, and any point
   replaces a "no data" marker; a newer UNS value written meanwhile is
   kept. Rows are only updated, so values of a device the sync removes
   meanwhile stay gone. A row keeps its source, so a UNS leaf stays in the
   compositions built from UNS values. A leaf with no point since has not
   changed. Rows InfluxDB cannot vouch for (a leaf without MetricMeta, or
   with no device) are dropped; a "no data" marker for a leaf without
   MetricMeta stays, as InfluxDB can never have data for it. Then every
   row is trusted again, and the counts and time are logged.

The values are cleared instead, as before, when there is no History to
catch up from, when there is no record of when they were current (the
first start of this version) or that record is in the future, when the gap is
longer than `I3X_CATCHUP_MAX_GAP_MS` (default 24 h, at most 30 days; keep
it below the InfluxDB bucket's retention, or points from the gap may have
gone), when the catch-up query still fails after three retries (5, 15 and
45 s apart), or when more than 1,000,000 stored values changed (a fixed
limit). A failed group commit still clears. A clear that fails hides the
rows it should have removed, and is tried again every 5 s. A reconnect during a catch-up starts it again from
the same time; `values_current_until` does not move until a catch-up
finishes, so a crash part way through is caught up again on the next
start.

Values kept from InfluxDB, and "no data" markers, are refreshed the same
way while connected, every `I3X_INFLUX_REFRESH_MS` (default 5 min): the
catch-up query over the time since the last refresh (less the margin),
for the leaves those rows hold, found through the partial index
`last_value_kept_ix` (created on open if missing, so no rebuild). The
first refresh after a catch-up covers the whole gap again, for values
read from InfluxDB while the historian may still have been writing. Only
devices that publish to the UNS keep InfluxDB values, but i3X decides
that from ConfigDB while the ingester decides from the birth
certificate, so a device can change only in InfluxDB while it is kept
here. Before the catch-up only the clear at start or on a reconnect
replaced such values; now they are behind by at most one interval, the
query time and the historian's write delay. A refresh that takes longer
than the interval is logged. A failed refresh is logged and the next covers the
same time again; after a gap longer than `I3X_CATCHUP_MAX_GAP_MS`, or more
than 1,000,000 changes, those rows are dropped, 500 at a time, and read
again when asked for.

Only a later UNS message replaces a value kept from InfluxDB, so values
(and "no data" markers) are kept only for devices that publish to UNS.
uns-ingester-sparkplug publishes a device only if its birth certificate has
an ISA-95 hierarchy with at least an Enterprise; the Sparkplug historian
writes every device to InfluxDB. `ObjectTree.publishesToUns` tells them
apart by where the device sits: a device without a hierarchy is filed under
`<namespace>/Unknown`, and a UNS message moves a device under the levels it
was published with. Like the ingester, the tree takes the hierarchy only
from `Device_Information/ISA95_Hierarchy`. A real hierarchy of exactly
`<namespace>/Unknown` counts as none, which costs only InfluxDB reads. A
device without a hierarchy is read from InfluxDB on every request. A
composition that includes it has no markers for its leaves, so it is never
complete: it is built from the UNS values of its other devices, as on main,
or read from InfluxDB whole if it has none. History
checks just before each write, so a device that loses its hierarchy during
a read keeps nothing. When a DeviceInformation change leaves a device
without a hierarchy, ConfigSync drops its InfluxDB values and markers
(`removeInfluxValues`); its UNS values stay.

The check reads ConfigDB, while the ingester reads the device's birth
certificate. Edge agents build births from the same DeviceInformation, but
if they disagree (a birth not yet republished after a change) a device with
a hierarchy in ConfigDB and none in its birth keeps InfluxDB values that no
UNS message replaces, until the next clear at start or reconnect.

A composition's cached value is every UNS value in its whole subtree, in
tree order (the cache path does not apply maxDepth). Near the top of the
ISA-95 hierarchy that is millions of components, so `getValueLazy` reads
them with one recursive query over a read snapshot, and the value routes
stream them to the client instead of building the value.

Exposes: `getValue(elementId)`, `getValueLazy(elementId)`,
`getChildValues(elementId, maxDepth)`.

### history.ts

Translates i3X value and history requests into Flux queries against the
Sparkplug bucket, using each leaf's MetricMeta (measurement name, device,
path). Current values for many leaves are read with a few bulk `last()`
queries. Every Flux query, for current values and history alike, waits for
a slot in a process-wide semaphore (`I3X_INFLUX_CONCURRENCY`, default 4).
History is only served for leaf metrics.

### subscriptions.ts

In-memory subscription store with SSE and sync delivery. Ownership is the
authenticated principal. Each subscription queues updates for sync and
stream replay; the queue holds at most `I3X_SUBSCRIPTION_QUEUE_MAX`
updates (default 10,000), dropping the oldest and counting the drops.
Subscriptions not used within the TTL are deleted.

### MCP and the RAG index (opt-in)

With `I3X_MCP_ENABLED=true`, `/mcp` serves MCP tools over a graph and
full-text index of the whole tree. The index is built on the first MCP
query and again on the first query after any change. It costs about 47 KB
of heap per device, so it is off by default; then nothing is built and
`/mcp` answers 404.

### mapping.ts, quality.ts, types/i3x.ts

Pure translation helpers, quality derivation and the i3X type definitions.

## Endpoint Mapping

All mounted under `/v1/`:

### Server Info (no auth)
| Method | Path | Source |
|--------|------|--------|
| GET | `/info` | Static capabilities |

### Explore (all REQUIRED)
| Method | Path | Source |
|--------|------|--------|
| GET | `/namespaces` | Object tree |
| GET | `/objecttypes` | Object tree (ConfigDB classes + schemas) |
| GET | `/objecttypes/:elementId` | Object tree |
| POST | `/objecttypes/query` | Object tree bulk |
| GET | `/relationshiptypes` | Object tree |
| GET | `/relationshiptypes/:elementId` | Object tree |
| POST | `/relationshiptypes/query` | Object tree bulk |
| GET | `/objects` | Object tree, streamed in chunks |
| GET | `/objects/:elementId` | Object tree |
| POST | `/objects/list` | Object tree bulk |
| GET | `/objects/:elementId/related` | Object tree relationships |
| POST | `/objects/related` | Object tree bulk |

### Query (REQUIRED for value, OPTIONAL for history — we implement both)
| Method | Path | Source |
|--------|------|--------|
| GET | `/objects/:elementId/value` | Value cache |
| POST | `/objects/value` | Value cache bulk |
| GET | `/objects/:elementId/history` | InfluxDB |
| POST | `/objects/history` | InfluxDB bulk |

### Subscribe (REQUIRED + SSE)
| Method | Path | Source |
|--------|------|--------|
| POST | `/subscriptions` | Subscription manager |
| POST | `/subscriptions/list` | Subscription manager |
| POST | `/subscriptions/delete` | Subscription manager |
| POST | `/subscriptions/register` | Subscription manager |
| POST | `/subscriptions/unregister` | Subscription manager |
| POST | `/subscriptions/stream` | Subscription manager (SSE) |
| POST | `/subscriptions/sync` | Subscription manager (polling) |

## Response Envelope

Express middleware wraps all responses in the i3X envelope:

```typescript
// Success (single)
{ "success": true, "result": <data> }

// Success (write/void)
{ "success": true, "result": null }

// Error
{ "success": false, "error": { "message": "..." } }

// Bulk (partial failure)
{
  "success": false,
  "results": [
    { "success": true, "elementId": "...", "result": { ... } },
    { "success": false, "elementId": "...", "error": { "message": "..." } }
  ]
}
```

Bulk responses preserve request array order and size.

Gzip compression via `compression` middleware when client sends `Accept-Encoding: gzip`.

## Authentication

HTTP Basic Auth via WebAPI's built-in `FplusHttpAuth` middleware (spec deviation D1
in TID). Username/password verified against Kerberos via `GSS.verifyCredentials()`.
Sets `req.auth` to authenticated principal UPN. ACL checks via `Auth.check_acl()`
per request.

`GET /v1/info` is mounted outside the auth middleware (spec requirement).

## Environment Variables

```bash
# Standard ACS service vars
DIRECTORY_URL=http://directory.namespace.svc.cluster.local
REALM=EXAMPLE.COM
PORT=8080
HOSTNAME=i3x.namespace.svc.cluster.local
DEVICE_UUID=<service device uuid>
CLIENT_KEYTAB=/keytabs/client
SERVER_KEYTAB=/keytabs/server

# InfluxDB
INFLUX_URL=http://influxdb.namespace.svc.cluster.local
INFLUX_TOKEN=<token>
INFLUX_ORG=<org>
INFLUX_BUCKET=default

# i3X specific
I3X_NAMESPACE_NAME=<organisation name from Helm values.organisation>
I3X_NAMESPACE_URI=<organisation URI>
I3X_SUBSCRIPTION_TTL=300000
I3X_SUBSCRIPTION_QUEUE_MAX=10000   # updates queued per subscription
I3X_STALE_THRESHOLD=300000
I3X_MAX_DEPTH_CAP=0                # 0: no cap on composition maxDepth

# Storage and sync
I3X_DB_PATH=/data/i3x.db           # ":memory:" also works
I3X_DB_CACHE_MB=64                 # SQLite page cache
I3X_SYNC_CONCURRENCY=16            # ConfigDB fetches in flight
I3X_INFLUX_CONCURRENCY=4           # Flux queries in flight, process-wide
I3X_MCP_ENABLED=false              # serve /mcp and build the RAG index

# Logging
VERBOSE=ALL,!query,!acl,!notify-msg
```

## Test Strategy

Jest suites under `test/`, run with Node 22 (`node:sqlite`):

- `store.test.ts`: the database (schema rebuild, warm reopen, group
  commit, savepoints) and the tree's rows (ISA-95 sharing and cleanup,
  order, object types, `iterateObjects`).
- `object-tree.test.ts`, `preserve-uns-nodes.test.ts`: the tree's public
  API, and UNS nodes across device rebuilds on random trees.
- `sync.test.ts`: ConfigSync against a fake ConfigDB: cold sync, warm
  restart, child updates, membership changes, reconnects, schemas, the
  concurrency cap, in-flight races, retries.
- `values.test.ts`: UNS batching, InfluxDB write-back, device removal and
  the Flux semaphore, through the real API.
- `objects-stream.test.ts`: `GET /objects` sends exactly the bytes
  `res.json` sent, and waits for slow clients.
- `api-v1.test.ts`, `e2e.test.ts`: every endpoint and the i3X envelope,
  over mocked components.
- `subscriptions.test.ts`, `history*.test.ts`, `value-cache.test.ts`,
  `mapping.test.ts`, `quality.test.ts`, `envelope.test.ts`, `rag/`, `mcp/`.
- `history-influx.test.ts` runs against a real InfluxDB when
  `I3X_TEST_INFLUX_URL` is set.
