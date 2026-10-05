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
  them again.
- Group commit: writes join one open transaction that commits 250 ms after
  the first write. A COMMIT costs more than one device's or one UNS
  message's writes, so this keeps the commit rate low. Nested
  `transaction()` calls are savepoints. The process sees its writes at
  once; a crash loses at most the open batch.

Tables:

| Table | Holds |
|---|---|
| `object` | Every i3X object: elementId, parent, type, display name, composition flag, source (`config` or `uns`). `seq` keeps insertion order. |
| `metric_meta` | InfluxDB query metadata per leaf metric. |
| `object_type` | ObjectTypes: display name and JSON schema. |
| `device_schema` | The Schema_UUIDs each device in the tree references. |
| `sync_device`, `sync_schema` | The ConfigDB ETags each device and schema was last built from. |
| `last_value` | The last value of each leaf metric, with the object it is filed under (`anchor`) and its device. |
| `meta` | Fingerprint, and whether a sync has completed. |

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
  from it instead of building one array.
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
so writes never interleave. Failed fetches are retried after 10 s. A cold
sync logs progress every 1,000 devices.

### value-cache.ts

Subscribes to `UNS/v1/#`. On each message:
1. Parses the UNS topic (ISA-95 hierarchy + metric path).
2. Reads the MQTT v5 user properties (InstanceUUIDPath, SchemaUUIDPath).
   A trailing `:` (uns-ingester sends `device:` for a metric directly under
   the device) does not add an empty segment.
3. Adds any new composition nodes to the object tree.
4. Queues the VQT for the `last_value` table; queued values are written
   every 250 ms or 5,000 values, and every read flushes first.
5. Notifies the subscription manager.

InfluxDB values that History reads on a cache miss are written back
(`recordInfluxValues`), never over a newer UNS value. Values are cleared at
start and on an MQTT reconnect, because UNS messages sent while i3X was
not listening are lost.

Exposes: `getValue(elementId)`, `getChildValues(elementId, maxDepth)`.

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
