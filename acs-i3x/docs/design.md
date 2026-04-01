# acs-i3x Technical Design

## Overview

A TypeScript ACS service that implements the i3X (Industrial Information Interoperability eXchange) REST/SSE API specification, translating i3X queries into calls against existing Factory+ services. Read-only. Full spec compliance for all REQUIRED endpoints plus history and SSE streaming.

See [pitch.md](pitch.md) for strategic context and data model mapping.
See [to-improve.md](to-improve.md) for tracked spec deviations and known limitations.

## Project Structure

```
acs-i3x/
├── docs/
│   ├── pitch.md
│   ├── to-improve.md
│   └── design.md              (this file)
├── bin/
│   └── api.ts                 Entry point (WebAPI + ServiceClient init)
├── src/
│   ├── constants.ts           UUIDs, permissions, version
│   ├── git-version.ts         (generated at build)
│   ├── routes.ts              Route factory → Express app
│   ├── api-v1.ts              i3X v1 endpoint router
│   ├── object-tree.ts         Object graph from ConfigDB + Directory
│   ├── value-cache.ts         UNS MQTT → in-memory VQT cache
│   ├── history.ts             InfluxDB query translation
│   ├── subscriptions.ts       Subscription manager (SSE + sync)
│   ├── mapping.ts             Factory+ → i3X translation helpers
│   ├── quality.ts             Quality state machine
│   └── types/
│       └── i3x.ts             i3X response/request type definitions
├── test/
│   ├── explore.test.ts        Explore endpoint tests
│   ├── value.test.ts          Current value tests
│   ├── history.test.ts        History endpoint tests
│   ├── subscriptions.test.ts  Subscription lifecycle + SSE + sync tests
│   ├── envelope.test.ts       Response envelope format tests
│   ├── auth.test.ts           Auth rejection tests
│   ├── mapping.test.ts        Data model mapping unit tests
│   └── helpers/
│       └── mock-services.ts   Mock ConfigDB, Directory, Auth, InfluxDB, MQTT
├── package.json
├── tsconfig.json
├── Dockerfile
├── Makefile
└── .env.example
```

## Dependencies

```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node --es-module-specifier-resolution=node dist/bin/api.js",
    "test": "jest"
  },
  "dependencies": {
    "@amrc-factoryplus/service-client": "file:../lib/js-service-client",
    "@amrc-factoryplus/service-api": "file:../lib/js-service-api",
    "@influxdata/influxdb-client": "^1.x",
    "compression": "^1.x",
    "pino": "^8.x",
    "uuid": "^9.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "jest": "^29.x",
    "ts-jest": "^29.x",
    "@types/express": "^4.x",
    "@types/compression": "^1.x",
    "@types/node": "^20.x"
  }
}
```

`service-api` provides WebAPI (Express + Kerberos/Basic/Bearer auth + CORS + error handling).
`service-client` provides ServiceClient (ConfigDB, Directory, Auth, MQTT).

## Entry Point (bin/api.ts)

```
ServiceClient.init()
    → start object-tree (queries ConfigDB + Directory, builds graph)
    → start value-cache (subscribes to UNS/v1/#, populates VQT store)
    → wait for initial warm-up
    → WebAPI.init({ routes, ping })
    → api.run()
```

WebAPI handles HTTP server, auth middleware, CORS. Routes factory mounts the i3X
v1 router at `/v1/`. The `/v1/info` endpoint is mounted outside auth middleware
(spec requires it unauthenticated). Returns 503 for any request (except `/v1/info`)
while warming up.

## Core Components

### object-tree.ts

Builds and maintains the i3X object graph from Factory+ services.

On startup, queries:
- `ConfigDB.class_members(Device)` for all device objects
- `ConfigDB.get_config(ConfigSchema, classUuid)` for each class's JSON schema
- `Directory.get_device_info(uuid)` for online status per device

Builds: namespace, objectTypes map, objects map, relationshipTypes.

Re-polls every 60s to pick up changes (TID L1 — to be replaced with Directory
change notification).

Composition sub-objects are added when the value cache sees a UNS message (which
carries SchemaUUIDPath and InstanceUUIDPath in MQTT v5 custom properties). Top-level
device objects exist from ConfigDB alone; internal structure comes from live data.

Only devices with ISA-95 Enterprise set are included (same filtering as UNS ingester).

Exposes: `getNamespaces()`, `getObjectTypes(?namespaceUri)`, `getObjectType(elementId)`,
`getObjects(?typeElementId, ?root)`, `getObject(elementId)`, `getRelated(elementId, ?relationshipType)`,
`getRelationshipTypes()`.

### value-cache.ts

Subscribes to `UNS/v1/#`. On each message:
1. Parses UNS topic structure (ISA-95 hierarchy + metric path)
2. Reads MQTT v5 custom properties (InstanceUUID, SchemaUUID, InstanceUUIDPath, SchemaUUIDPath, Type, Unit)
3. Stores VQT keyed by composite of InstanceUUIDPath + metric name
4. Updates object tree with composition structure from UUID paths (if new)
5. Notifies subscription manager of value changes

Exposes: `getValue(elementId)`, `getChildValues(elementId, maxDepth)`.

### history.ts

Translates i3X history requests to InfluxDB Flux queries.

- Leaf metric elementId → filter by `bottomLevelInstance` tag + measurement name
- Composition elementId → filter by `topLevelInstance` or `usesInstances` containing the UUID
- Maps startTime/endTime to Flux `range()`
- Respects maxDepth for composition queries
- Returns VQT arrays in i3X format

### subscriptions.ts

In-memory subscription store with SSE and sync delivery.

- `create(clientId)` → allocates subscription with unique ID + queue
- `register(subscriptionId, elementIds, maxDepth)` → maps elementIds to value-cache watch keys
- `unregister(subscriptionId, elementIds)` → removes watch keys
- `stream(subscriptionId, res)` → sets SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`), pipes value changes to response. One SSE connection per subscription (spec requirement).
- `sync(subscriptionId, lastSequenceNumber)` → returns queued updates with monotonic sequence numbers, advances cursor on acknowledge
- `delete(subscriptionId)` → removes subscription and all queued values
- `list(clientId, subscriptionIds)` → returns subscription details
- TTL cleanup: subscriptions not accessed within configurable timeout are deleted

### mapping.ts

Pure translation functions between Factory+ and i3X data shapes:

- `toI3xNamespace(orgName, orgUri)` → i3X Namespace
- `toI3xObjectType(classUuid, schema, namespace)` → i3X ObjectType
- `toI3xObject(obj, directoryInfo, parentId, isComposition)` → i3X Object
- `toI3xVqt(value, quality, timestamp)` → i3X VQT
- `toI3xRelationshipType(id, name, reverseId, namespace)` → i3X RelationshipType
- `wrapResponse(result)` → `{ success: true, result }`
- `wrapError(message)` → `{ success: false, error: { message } }`
- `wrapBulkResponse(results)` → ordered bulk response with per-item success/error

### quality.ts

Derives i3X quality from device/metric state:

- Device online + value received → `Good`
- Device online + in birth but no DATA yet → `GoodNoData`
- Device offline → `Bad`
- Metric timestamp older than configurable threshold → `Uncertain`

### types/i3x.ts

TypeScript interfaces for all i3X request and response shapes: Namespace,
ObjectType, Object, RelationshipType, VQT, ValueResponse, HistoryResponse,
SubscriptionRequest, BulkRequest, ResponseEnvelope, ErrorEnvelope, etc.

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
| GET | `/objects` | Object tree (ConfigDB + Directory) |
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
I3X_POLL_INTERVAL=60000
I3X_SUBSCRIPTION_TTL=300000
I3X_STALE_THRESHOLD=300000

# Logging
LOG_LEVEL=info
```

## Test Strategy

### Unit tests (Jest, mocked services)
- `mapping.test.ts` — pure function tests for every translation helper
- `envelope.test.ts` — response wrapping, bulk response ordering, error shapes
- `quality.test.ts` — quality derivation from all device states

### Integration tests (mock MQTT + mock HTTP backends)
- `explore.test.ts` — all explore endpoints return correct i3X shapes
- `value.test.ts` — current values, maxDepth composition, quality mapping
- `history.test.ts` — InfluxDB query construction, time range translation
- `subscriptions.test.ts` — full lifecycle: create → register → stream/sync → unregister → delete → TTL cleanup
- `auth.test.ts` — 401 missing auth, 403 insufficient ACL, /info unauthenticated

### Mock services
Simulate: ConfigDB class/member/config responses, Directory device info, Auth ACL
checks, InfluxDB Flux query results, UNS MQTT messages with v5 custom properties.
