# acs-i3x Architecture

## Service Overview

```mermaid
graph TB
    Client["i3X Client<br/>(Explorer, Aggregator, etc.)"]
    
    subgraph acs-i3x["acs-i3x service"]
        OT["ObjectTree<br/>objects, types,<br/>hierarchy, metricMeta"]
        VC["ValueCache<br/>UNS cache (live)"]
        HI["History<br/>Flux queries"]
        SM["SubscriptionMgr<br/>SSE/sync queues"]
    end
    
    ConfigDB["ConfigDB<br/>DeviceInfo app<br/>Info app<br/>ConfigSchema app<br/>class_members"]
    MQTT["MQTT Broker<br/>UNS/v1/#"]
    InfluxDB["InfluxDB<br/>(default bucket)"]
    
    Client -->|"REST / SSE"| acs-i3x
    OT -->|"STARTUP"| ConfigDB
    VC -->|"RUNTIME"| MQTT
    HI -->|"ON REQUEST"| InfluxDB
    SM -->|"RUNTIME"| MQTT
```

## Startup: ObjectTree builds from ConfigDB

The entire object hierarchy is built at startup from ConfigDB. **The Directory is not used.**

```mermaid
sequenceDiagram
    participant OT as ObjectTree
    participant CDB as ConfigDB

    OT->>CDB: class_members("18773d6d..." Device class)
    CDB-->>OT: [uuid1, uuid2, ...] (104 devices)
    
    loop For each device UUID
        OT->>CDB: get_config(DeviceInfo app, device)
        CDB-->>OT: originMap (full metric structure)
        Note right of OT: Extract from originMap:<br/>- schema (Schema_UUID = type)<br/>- Instance_UUID<br/>- ISA-95 hierarchy<br/>- Full metric tree (recursive)
        
        OT->>CDB: get_config(Info app, device)
        CDB-->>OT: { name: "MABI_Robot" }
    end
    
    loop For each unique Schema_UUID
        OT->>CDB: get_config(ConfigSchema app, schema)
        CDB-->>OT: JSON Schema definition
    end
    
    Note over OT: Produces:<br/>- i3X Namespace<br/>- ObjectTypes (per Schema_UUID)<br/>- Objects (ISA-95 → device → metrics)<br/>- MetricMeta per leaf<br/>- Instance ↔ ConfigDB UUID mapping
```

### What the DeviceInformation app config contains

This is the same `originMap` the edge agent uses to build Sparkplug birth certificates:

```
originMap:
  Schema_UUID: "481dbce2..."          ← device schema (becomes typeElementId)
  Instance_UUID: "7192c247..."        ← device identity (for InfluxDB queries)
  Device_Information:
    Schema_UUID: "2dd093e9..."
    ISA95_Hierarchy:
      Schema_UUID: "84ac3397..."      ← found by recursive search
      Enterprise: { Value: "AMRC" }
      Site: { Value: "F2050" }
      Area: { Value: "Boardroom" }
  Phases:
    1:
      Schema_UUID: "d16b825d..."
      Instance_UUID: "1231982e..."
      True_RMS_Current:
        Sparkplug_Type: "FloatLE"     ← leaf metric
        Eng_Unit: "A"
```

The tree builder walks this recursively:
- Keys with child containers become **composition objects**
- Keys with `Sparkplug_Type` and no children become **leaf objects**
- `Instance_UUID` used where available, v5 UUID synthesised otherwise
- `MetricMeta` stored per leaf for InfluxDB queries

## Runtime: Current Values (hybrid)

```mermaid
flowchart TD
    REQ["GET /objects/:id/value"]
    CACHE{"ValueCache<br/>has value?"}
    INFLUX["InfluxDB last() query<br/>bucket: default"]
    MQTT["MQTT UNS/v1/#<br/>(continuous)"]
    RESP_CACHE["Return cached value<br/>(real-time, sub-second)"]
    RESP_INFLUX["Return InfluxDB value<br/>(~10s delayed)"]
    RESP_404["404 No value"]

    MQTT -->|"populates"| CACHE
    REQ --> CACHE
    CACHE -->|"hit"| RESP_CACHE
    CACHE -->|"miss"| INFLUX
    INFLUX -->|"found"| RESP_INFLUX
    INFLUX -->|"empty"| RESP_404
```

| Source | Freshness | Coverage |
|---|---|---|
| ValueCache (UNS MQTT) | Real-time (sub-second) | Only devices publishing to UNS (requires ISA-95 config) |
| InfluxDB last() | ~10s delayed (historian flush interval) | All devices with any historical data |

## On Request: History

```mermaid
sequenceDiagram
    participant Client
    participant API as api-v1
    participant HI as History
    participant OT as ObjectTree
    participant IDB as InfluxDB

    Client->>API: GET /objects/:id/history?startTime=...&endTime=...
    API->>OT: getMetricMeta(elementId)
    OT-->>API: { topLevelInstanceUuid, metricPath, metricName, typeSuffix }
    API->>HI: queryHistory(elementId, start, end)
    
    Note over HI: Builds Flux query:<br/>from(bucket: "default")<br/>  |> filter(measurement == "True_RMS_Current:d")<br/>  |> filter(topLevelInstance == "7192c247...")<br/>  |> filter(path == "Phases/1")<br/>  |> range(start, stop)<br/>  |> sort(columns: ["_time"])
    
    HI->>IDB: Flux query
    IDB-->>HI: rows
    HI-->>API: I3xVqt[]
    API-->>Client: { success: true, result: { elementId, values: [...] } }
```

### How MetricMeta maps to InfluxDB tags

| MetricMeta field | InfluxDB concept | Example |
|---|---|---|
| `topLevelInstanceUuid` | `topLevelInstance` tag | `7192c247-573c-4e9d-89fe-618acdc99c2b` |
| `metricPath` | `path` tag | `Phases/1` |
| `metricName` + `typeSuffix` | `_measurement` | `True_RMS_Current:d` |

The type suffix is derived from `Sparkplug_Type` in the originMap:

| Sparkplug_Type | Suffix | InfluxDB field type |
|---|---|---|
| Float, Double, FloatLE, DoubleBE, etc. | `:d` | float |
| Int8, Int16, Int32, Int64 | `:i` | integer |
| UInt8, UInt16, UInt32, UInt64 | `:u` | unsigned integer |
| Boolean | `:b` | boolean |
| String (default) | `:s` | string |

## Runtime: SSE Streaming

```mermaid
sequenceDiagram
    participant Client as i3X Client
    participant API as api-v1
    participant SM as SubscriptionMgr
    participant VC as ValueCache
    participant MQTT as MQTT Broker

    Client->>API: POST /subscriptions { clientId }
    API-->>Client: { subscriptionId }
    
    Client->>API: POST /subscriptions/register { elementIds }
    API->>SM: register(elementIds)
    
    Client->>API: POST /subscriptions/stream
    API->>SM: stream(res)
    Note over SM: Sets SSE headers<br/>Holds connection open
    
    loop Continuous
        MQTT-->>VC: UNS/v1/.../metric message
        VC->>VC: cache.set(elementId, vqt)
        VC->>SM: onValueChange(elementId, vqt)
        SM->>SM: elementId registered?
        SM-->>Client: data: [{ elementId, value, quality, timestamp }]
    end
```

Only works for devices publishing to UNS. Devices not on UNS never trigger SSE events (tracked in TID L3).

## Data Source Summary

| Data | Source | When | Latency |
|---|---|---|---|
| Object hierarchy (types, tree, ISA-95) | ConfigDB DeviceInformation app | Startup | Once |
| Object names | ConfigDB Info app | Startup | Once |
| JSON Schemas | ConfigDB ConfigSchema app | Startup | Once |
| Current value (primary) | MQTT UNS/v1/# via in-memory cache | Continuous | Real-time |
| Current value (fallback) | InfluxDB default bucket, last() | On request | ~10s |
| Historical values | InfluxDB default bucket, range query | On request | N/A |
| SSE streaming | MQTT UNS/v1/# via SSE bridge | Continuous | Real-time |
| Device online/offline | Not currently used | -- | -- |
