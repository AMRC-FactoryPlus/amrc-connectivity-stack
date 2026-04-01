# acs-i3x: i3X-Compatible Northbound API for ACS

## Problem

ACS has no standard northbound API. If you're an external system, another facility, or a non-MQTT consumer, you have to learn our proprietary service APIs (Directory, ConfigDB, InfluxDB Flux) to get data out. Every integration is bespoke.

Concrete story: the AMRC has a Star metrology database and an ACS deployment on the same shop floor. A data portal that wants to show time-series from both sources today needs two completely different integrations, two query languages, two auth mechanisms. There's no common query interface.

Meanwhile, i3X (Industrial Information Interoperability eXchange) is an open REST API spec backed by CESMII, AWS, Siemens, Rockwell, Inductive Automation, and others. It defines standard endpoints for discovery, live values, history, and subscriptions. If ACS speaks i3X, any i3X-compatible client (explorers, aggregators, dashboards, MES systems) can query it out of the box. And an i3X aggregator can stitch ACS and Star (or any other i3X source) into a single endpoint.

This also positions us to contribute to the spec while it's still alpha, as we did with Sparkplug.

## Appetite

Large feature. Full i3X spec compliance (all REQUIRED endpoints, plus history and SSE streaming). This is strategic investment, not a quick win.

## Solution

### Architecture

A new ACS service (`acs-i3x`) that sits in front of the existing stack and translates i3X REST requests into Factory+ service calls.

```
i3X Client (Explorer, Aggregator, Dashboard, MES)
        |
        v  (REST / SSE)
   acs-i3x service
        |
        |-- ConfigDB -----> ObjectTypes (classes + JSON schemas)
        |                    Objects (class members, registry)
        |                    Relationships (class/subclass/membership)
        |
        |-- Directory -----> Device online/offline status
        |                    Service registrations
        |                    Semantic links
        |
        |-- UNS MQTT ------> Live value cache (current VQTs)
        |   (UNS/v1/#)       Subscription bridge (SSE + sync)
        |
        |-- InfluxDB -------> Historical value queries
        |   (historian-uns    (filter by Instance_UUID tags)
        |    tag structure)
        |
        |-- Auth ------------> ACL checks per request
```

### Data Model Mapping

The mapping from Factory+ to i3X is nearly 1:1 because Factory+ schemas already have the right structure:

| Factory+ Concept | i3X Concept | Mapping |
|---|---|---|
| ACS deployment (`values.organisation` from Helm) | Namespace | One namespace per deployment, URI from Helm config |
| ConfigDB class + ConfigSchema JSON | ObjectType | `elementId` = class UUID, `schema` from ConfigSchema app |
| ConfigDB object (Device class member) | Object (top-level) | `elementId` = ConfigDB object UUID |
| Schema composition instance (Instance_UUID) | Object (sub-object) | `elementId` = Instance_UUID (deterministic UUID v5 from device UUID + metric path) |
| Schema composition nesting | HasComponent / ComponentOf | Parent = containing Instance_UUID |
| ConfigDB class hierarchy | HasParent / HasChildren | From class/subclass/membership |
| Directory semantic links | RelationshipType | From Directory link table |
| Leaf Sparkplug metric | Value (VQT) | `value` = metric value, `quality` mapped from device state, `timestamp` from metric |
| InfluxDB historian-uns data | History | Query by `bottomLevelInstance` / `topLevelInstance` tags with time range |

### Object Tree

A Factory+ device publishes a tree of metrics in its Sparkplug birth certificate. Each level with a `Schema_UUID` and `Instance_UUID` becomes an i3X Object. Leaf metrics become values.

```
CNC Machine (Object, elementId = ConfigDB UUID, type = CNC-v1)
  |-- Device_Information (Object, elementId = Instance_UUID, type = Device_Information-v1)
  |     |-- Manufacturer = "Siemens"           (leaf value)
  |     |-- ISA95_Hierarchy (Object, elementId = Instance_UUID, type = Hierarchy-v1)
  |           |-- Enterprise = "AMRC"          (leaf value)
  |           |-- Site = "Factory 2050"        (leaf value)
  |-- Axes/X (Object, elementId = Instance_UUID, type = Axis-v1)
  |     |-- Position (Object, elementId = Instance_UUID, type = Commanded_Value-v1)
  |           |-- Actual = 125.3               (leaf value)
  |-- Axes/Y (Object, elementId = Instance_UUID, type = Axis-v1)
        |-- ...
```

Composition objects have `isComposition: true`. Their value is the assembled JSON of their children (respecting `maxDepth`).

### Elements

**1. Service shell (`acs-i3x`)**
TypeScript service using `ServiceClient`. Express or Fastify. Deployed as a standard ACS Helm component. Subscribes to `UNS/v1/#` on startup.

**2. `GET /info` — capabilities**
```json
{
  "specVersion": "0.1.0",
  "serverName": "AMRC Connectivity Stack",
  "capabilities": {
    "query": { "history": true },
    "update": { "current": false, "history": false },
    "subscribe": { "stream": true }
  }
}
```
Unauthenticated. Returns 503 while the service is warming up.

**3. Object tree builder**
On startup, queries ConfigDB for all Device class members and their class hierarchy, plus ConfigSchema app for JSON schemas. Queries Directory for online status. Builds in-memory object graph. Re-polls every 60s to pick up changes (see TID L1). Only includes devices that have ISA-95 Enterprise set (same filtering as the UNS ingester).

**4. Live value cache**
In-memory store populated from `UNS/v1/#` MQTT messages. Keyed by Instance_UUID (from UNS custom properties). Stores last-known value, timestamp, and derived quality. UNS custom properties provide SchemaUUIDPath and InstanceUUIDPath for tree reconstruction.

**5. Explore endpoints (all REQUIRED)**
- `GET /namespaces` — single namespace from Helm `values.organisation`
- `GET /objecttypes`, `POST /objecttypes/query` — ConfigDB classes with schemas
- `GET /objects`, `POST /objects/list` — ConfigDB objects + Directory status + composition from value cache
- `GET /objects/{elementId}/related`, `POST /objects/related` — class hierarchy + Directory links
- `GET /relationshiptypes`, `POST /relationshiptypes/query` — HasParent/HasChildren, HasComponent/ComponentOf, plus any Directory link relation types

**6. Value endpoints**
- `POST /objects/value`, `GET /objects/{elementId}/value` — serve from live value cache. Composition objects return assembled child values respecting `maxDepth`.
- `POST /objects/history`, `GET /objects/{elementId}/history` — translate to InfluxDB Flux queries using historian-uns tag structure. Filter by `bottomLevelInstance` tag for specific containers, `topLevelInstance` for device-level. Respect `maxDepth`.

**7. Subscription endpoints (all REQUIRED + SSE)**
- `POST /subscriptions` — create subscription, allocate in-memory queue
- `POST /subscriptions/register` — map elementIds to UNS MQTT topics via Instance_UUID index, subscribe
- `POST /subscriptions/stream` — hold SSE connection, push VQT updates from MQTT as `text/event-stream`
- `POST /subscriptions/sync` — polling with monotonic sequence numbers, acknowledge-and-advance
- `POST /subscriptions/unregister`, `POST /subscriptions/delete`, `POST /subscriptions/list` — lifecycle management
- TTL-based cleanup for abandoned subscriptions

**8. Quality mapping**
- Device online + metric received → `Good`
- Device online + metric in birth but no DATA yet → `GoodNoData`
- Device offline → `Bad`
- Metric timestamp older than configurable threshold → `Uncertain`

**9. Auth**
HTTP Basic Auth (spec deviation D1, see TID). Username/password passed through to ServiceClient for Factory+ authentication. ACL checks via Auth service per request. `GET /info` unauthenticated per spec.

**10. Response envelope**
All responses wrapped in `{ "success": true, "result": ... }` / `{ "success": false, "error": { "message": "..." } }`. Bulk responses preserve request order. Gzip compression when client sends `Accept-Encoding: gzip`.

**11. Test suite**
Full compliance test suite covering every REQUIRED endpoint. Mock Factory+ services for unit tests. Integration tests against a real ACS deployment. Tests for: response envelope format, bulk query ordering, maxDepth behaviour, subscription lifecycle, SSE event format, quality mapping, auth rejection, 503 during warmup.

## Rabbit Holes

**Namespace definition** — One namespace per ACS deployment. URI from Helm `values.organisation` (passed to the pod as an environment variable). Extensible to per-Enterprise namespaces later.

**elementId scheme** — ConfigDB object UUID for top-level device objects. Deterministic Instance_UUID (UUID v5 from device UUID + metric path) for sub-objects. No collision risk. Can reconstruct from schema structure.

**ObjectTypes without schemas** — Expose with empty `{"type": "object"}` schema. Tracked as TID item L2.

**Composition object values** — Value is the assembled JSON of child values matching the type schema. Leaf metrics return scalar values. `maxDepth` controls recursion depth.

**ISA-95 filtering** — Devices without ISA-95 Enterprise are invisible to i3X. Same behaviour as the UNS ingester. If you haven't configured your device's location in the hierarchy, it's not ready for interoperability.

**InfluxDB Instance_UUID querying** — historian-uns writes `bottomLevelInstance` and `topLevelInstance` as InfluxDB tags. Filter by `bottomLevelInstance` for specific container metrics, `topLevelInstance` for all device metrics. `usesInstances` tag contains full colon-separated path for hierarchy traversal.

**Startup** — Service returns HTTP 503 while building the object tree and warming the value cache. Slow startup is acceptable.

**Device change detection** — Re-poll ConfigDB/Directory every 60s. Not ideal but sufficient for PoC. Tracked as TID item L1.

## No-Gos

- **Update endpoints** — read-only. No `PUT /objects/{elementId}/value` or `PUT /objects/{elementId}/history`. Declared via `capabilities.update.current: false` and `capabilities.update.history: false`.
- **1.0 branch additions** — building against the main branch spec. No `/objects/{elementId}/shape`, no `metadata.extendedAttributes`, no `metadata.system` fields.
- **Multi-ACS aggregation** — that's the i3X aggregator's job, not ours. We expose one endpoint per ACS deployment.
- **Non-hierarchical relationship types** — only HasParent/HasChildren and HasComponent/ComponentOf plus Directory links. No arbitrary graph relationships.
- **Devices without ISA-95** — not visible through i3X. Same as UNS.
- **Spec-compliant auth** — using Basic Auth for now. Tracked as TID item D1.

## Supporting Documents

- [To-Improve Document (TID)](to-improve.md) — spec deviations and known limitations
