# Edge Scout: listing a device's addresses (design spec)

Status: design, November 2026. This page replaces the old Edge Scout draft, which described a design that ACS 7 removed. Line references are to `dev` at `a01b9e88`. While the feature is being built this page is a design draft, so the build's first PR takes it out of the public docs navigation (see "Removal list") and the last PR replaces it with the operator and architecture guide.

## Summary

Edge Scout asks a running driver to list the addresses its device offers, so an operator can pick addresses in the origin map editor instead of typing them. Every driver takes part through its driver library. A driver either implements scouting or answers that it cannot, and the Edge Agent can tell a driver built on an old library apart from both, so the UI can always say why a scan is not available.

- **Trigger.** The Admin UI sends the node command `Node Control/Scout` through the Command Escalation service, the route `RebirthButton.vue:44` already uses.
- **Negotiation.** The Edge Agent adds a `features` key to the `addr` packet, and a driver subscribes to the new `scout` topic only after it sees that key on the current MQTT session, so a new driver never touches a topic an old agent would refuse.
- **Protocol.** Requests go on `fpEdge1/<Conn>/scout` and the driver streams answers on `fpEdge1/<Conn>/found/<id>`.
- **Storage.** The agent writes each scan as a gzipped NDJSON snapshot to the Files service, in a File object it creates, and keeps a small per-connection status entry in ConfigDB that the UI watches.
- **Editor.** A side panel shows the discovered tree beside the schema tree. The operator applies or drags addresses onto metrics, and a re-scan shows what is new, changed, or missing from mapped metrics.
- **Rollout.** The agent advertises the feature only when `SCOUT_ENABLED` is on. It defaults to off until the release that ships the Admin UI, so every earlier step can merge without changing what a running agent does.

The old design is removed completely.

## Decisions for Alex

1. **Where snapshots live.** (a) Files service with a small new `DELETE` route (recommended). (b) Files with no delete, leaking an estimated 0.6 to 1.2 MB per 20,000-item scan. (c) ConfigDB only, which caps a scan at a few hundred plain items, or roughly 1,000 to 2,000 gzipped and base64-encoded, under the 100kb body limit (`deploy/values.yaml:177`).
2. **Name.** (a) Keep "Edge Scout", with "Scan" as the UI verb (recommended). (b) Rename to "Address scan" to avoid the unrelated Gateway Depot scout (`acs-gateway-depot/lib/depot.js:84`).
3. **Cross-agent writes.** ConfigDB checks `WriteConfig` against the app, not the object (`acs-configdb/lib/api-v2.js:236-245`), so any Edge Agent can overwrite any connection's status entry. (a) Accept it, with a UI check that the entry's `node` hosts the connection (recommended). (b) Add per-object write checks to ConfigDB first.
4. **Who may scan.** (a) Administrators only, through `ACS.PermGroup.CmdEsc` (recommended for the first release). (b) Also define an edge engineer grant set in the docs.
5. **First UI release.** (a) Panel, pick, drag, diff and states in phase 1, and bulk mapping and driver UI contract version 2 in phase 2 (recommended, because the UI is the largest estimate risk and contract version 2 has no consumer in this repo yet). (b) Everything at once, which adds about 5 days to phase 1.
6. **Connections with no devices.** The Admin UI drops these from the agent config (`acs-admin/src/utils/edgeAgentConfigUpdater.js:630-636`), so a scan needs one device first. (a) Accept this for the first release (recommended). (b) Keep device-less connections so they can be scanned first.
7. **OPC UA Server object.** (a) Skip `i=2253` by default and report namespace 0 as not checked, so mapped `CurrentTime` and `ServerStatus` metrics are never flagged missing (recommended). (b) List it by default, which adds a few hundred nodes to every scan.

## Goals and non-goals

Goals:

- One generic exchange for every driver, with a library default that answers "unsupported".
- Scans never stop data collection. Depth, item, time and size caps, pacing and cancellation are enforced in the library and again in the agent, and the agent's CPU and memory use during a scan is measured against the edge-agent chart's limits.
- Results of tens of thousands of items, kept after the scan, with re-scan of the whole connection or one branch.
- Selection inside the origin map editor, and later inside drivers with a custom HTML UI.
- Compatibility with old agents, old drivers, and drivers outside this repo, in both directions, including an agent rollback.

Non-goals:

- Changing the origin map without the operator, who still presses Save.
- Creating metrics the device schema does not define. "Turning addresses into metrics" means filling in schema metrics, or making `patternProperties` instances through `createObject` (`OriginMapEditor.vue:661`).
- Network discovery of devices, and scheduled or continuous scanning.

## Concepts and terms

- **Scan.** One run of scouting on one connection. Its id is a UUID, which is also the UUID of its snapshot File object. On the driver topics the id is that UUID without dashes, so it matches `\w+`.
- **Item.** One discovered entry, of kind `folder` (structure only) or `value` (can be bound to a metric). A value may also have children, as an MQTT topic has JSON leaves. An item's identity for binding is the pair (address, path), which maps exactly to a metric's `Address` and `Path`.
- **Item id.** A string the driver derives from the device alone, never from the scan's root, so the same node gets the same id in a full scan and in any branch scan. Each driver section defines its id scheme.
- **Root.** Where a scan starts. Null means the device's natural top. A branch scan sets it, together with the `folder_id` of the folder it re-scans.
- **Exhaustive.** Whether the driver's discovery is complete by nature. An OPC UA browse is exhaustive within its caps. An MQTT listen never is, because a quiet topic is missing but not gone.
- **Excluded scope.** A part of the device the scan deliberately did not visit, such as the OPC UA Server object. The driver reports each one in its `end` message, so the UI never calls an address under it missing.

A scan belongs to a **connection**, not a device, because the driver discovers on its southbound side. Every device on a connection, such as several devices on one MQTT broker, sees the same results.

## End-to-end flow

### First scan

1. With `SCOUT_ENABLED` on, the agent's `addr` packet carries `"features": {"scout": 1}` on every `READY`. A new library that sees it subscribes to `fpEdge1/<Conn>/scout` for the current MQTT session.
2. The agent's broker sees the subscription, and the agent sends a hello on `scout`. The library answers on `found/hello` with `supported` true or false. The agent keeps the answer in memory and writes it to the status entry only when it differs from what the entry holds, so a fleet restart writes nothing. If the driver has been `UP` for 10 s without subscribing, the agent records `"library"` in the same way.
3. The operator opens the Addresses panel in the origin map editor. The panel reads the status entry, the node's online state and its NBIRTH, sets options from the DriverDef `scout.options` schema, and the operator clicks **Scan**.
4. The UI calls `CmdEsc.request_cmd` with the node address, name `Node Control/Scout`, type `String`, and `{"version":1,"op":"start","request":"<uuid>","connection":"<conn uuid>","root":null,"folder_id":null,"options":{...},"limits":{...}}`. cmdesc checks the CmdDef permission and publishes NCMD (`acs-cmdesc/lib/cmdescd.js:93-140`). cmdesc answers 200 once the NCMD is published, whether or not the node is up (`cmdescd.js:131-139`), so the UI never treats that answer as acceptance.
5. The agent's NCMD switch (`acs-edge/lib/sparkplugNode.ts:383-394`) hands the request to the `ScoutManager`, which checks the request shape, checks the connection is deployed to this agent, clamps limits and checks concurrency. It then writes the scan fields with state `queued`, or writes only `last_request` with a refusal code and leaves the scan fields alone.
6. When the slot is free, the agent creates the snapshot File object, publishes `start` on `scout`, and writes state `running`.
7. The driver streams `found/<id>` messages: `items` batches, `progress` at least every 5 s, and one `end`. The agent validates each item, writes it as one NDJSON line into a gzip stream, and rewrites progress at most every 2 s, so the panel shows "Found 3,420 addresses, 41 s" and Stop.
8. On `end`, the agent uploads the gzip buffer to the Files service, writes state `done` with the new `current` and the old one as `previous`, and deletes the snapshot that dropped out.
9. The panel downloads the snapshot, a Web Worker decompresses and indexes it, and the tree renders. The operator binds items to metrics, and nothing is written until Save.

### Re-scan, branch scan and cancel

- **Re-scan** runs the same steps with a new scan id. The panel keeps showing the current snapshot under a banner until the new one is ready, then shows the change bar.
- **Branch scan** sends `root` set to a folder's `root` and `folder_id` set to the folder's `id`. The agent streams the current snapshot, drops that folder and everything under it, adds the new items, and writes the result as a new snapshot. "Re-scan semantics" has the exact rules.
- **Stop** sends `{"op":"cancel","request":...,"connection":...}`. The agent publishes `{"op":"cancel","id":...}`, the library stops within 5 s and ends with `CANCELLED`, and the previous snapshot stays current.
- **Two operators.** A second browser attaches to the running scan through the status entry. A second Scan press is refused with `BUSY` in `last_request`, which leaves the running scan's fields untouched, so both browsers keep the live scan.

## fpEdge1 protocol additions

These go into `acs-edge/docs/edge-split.md` as an optional part of the protocol.

### Advertising the feature

The `addr` packet gains one key. `version` stays 1.

```json
{"version": 1, "addrs": {...}, "groups": {...}, "features": {"scout": 1}}
```

This is safe on every agent and driver version:

- The spec requires drivers to accept and ignore unknown keys, and lets the agent add keys under an updated spec (`edge-split.md:307-310`).
- All three libraries already ignore extra keys. JS `setAddrs` checks only `version` (`lib/js-edge-driver/lib/driver.js:258-273`), Python `set_addrs` likewise (`lib/py-edge-driver/src/amrc/factoryplus/edge_driver/driver.py:257-275`), and Rust `AddrConfig` has no `deny_unknown_fields` (`lib/rs-edge-driver/src/driver.rs:307-313`).
- The agent sends `addr` after `conf` on every `READY`, so the driver learns the feature before any scan can arrive.

Libraries read `features` **first** in addr handling, before the handler check, the version check and address parsing. Today JS `setAddrs` returns early with no handler, an unknown version or a rejected address (`driver.js:259-273`), and Python has the same shape, so a driver with a bad config or a bad address map would otherwise never subscribe and would look like an old library.

The feature is remembered per MQTT session. A library clears its "feature seen" flag whenever it connects to the broker, and subscribes to `scout` from addr handling only, never from its connect handler. After an agent rollback, the driver reconnects, the older agent's `addr` has no `features` key, and the driver never asks for a topic the older ACL refuses.

Why not a `req/scout` hello: the broker closes a driver's connection when it publishes or subscribes outside its ACL (`acs-edge/lib/driverBroker.ts:205-216`, `edge-split.md:227-229`), and `req/\w+` and `rsp/\w+` only arrived in 17cadd91 (#726, v6.8.0). An unconditional hello would put a new driver into a reconnect loop on every older agent.

### Topics and ACL

| Topic | Direction | Purpose |
|---|---|---|
| `fpEdge1/<Conn>/scout` | agent to driver | hello, start, cancel. Subscribed only after `features.scout` is seen on this session |
| `fpEdge1/<Conn>/found/<id>` | driver to agent | hello answer, items, progress, end |

The ACL at `acs-edge/lib/driverBroker.ts:187-192` gains `found/\w+` on publish and `scout` on subscribe. The broker records which drivers subscribe to `scout` in a map kept like `#typed` (`driverBroker.ts:68-76`), and forgets them on unsubscribe and disconnect. Payloads are UTF-8 JSON, QoS 0, never retained.

`DriverBroker` also takes an optional `acl` function in its opts, used only by tests, so the end-to-end tests can run the pre-v6.8.0 ACL without a second copy of the broker.

### Agent to driver

```json
{"op":"hello","version":1}
{"op":"start","id":"3f9c1a2b44e0...","version":1,"root":null,"folder_id":null,
 "options":{},"limits":{"items":20000,"depth":8,"seconds":120,"pace_ms":20,"samples":false}}
{"op":"cancel","id":"3f9c1a2b44e0..."}
```

- `id` matches `^\w{1,64}$`.
- `options` is driver-specific, at most 8 KiB, and validated by the driver.
- `folder_id` is the `id` of the folder a branch scan replaces, or null. The driver must send an item with that id as the scan's first item.
- `limits` are the agent's clamped caps, which the library enforces. Defaults and ceilings are in the library section.
- Readers ignore keys they do not know.

### Driver to agent

Every message carries `seq`, which starts at 0 and goes up by 1 for each message of an `id`, and a `type`.

```json
{"seq":0,"type":"hello","versions":[1],"supported":true,"library":"rs-edge-driver 0.1.0"}
{"seq":0,"type":"accept"}
{"seq":1,"type":"items","items":[ITEM, ...]}
{"seq":2,"type":"progress","visited":3400,"found":1200,"note":"ns=2;s=Line1"}
{"seq":9,"type":"end","exhaustive":true,"truncated":false,"reason":null,
 "excluded":[{"id":"i=2253","reason":"skipped","prefixes":["i="]}]}
{"seq":0,"type":"end","error":{"code":"OPTIONS","message":"Root ns=2;s=Nope does not exist"}}
```

- `library` is the library's name and its package version at build time.
- An `items` message holds at most 500 items or 256 KiB, and the library splits batches.
- `reason` on a truncated scan is one of `items`, `depth`, `seconds`, `size` or `partial_access`. Cancellation is never a truncation, it is the error `CANCELLED`.
- `excluded` lists scopes the scan did not visit on purpose. `prefixes` optionally lists canonical address prefixes that fall inside the scope, which lets the UI place an address it did not find. An excluded scope without `prefixes` makes every unfound address "not seen" instead of "missing".
- A gap in `seq` ends the scan with `LOST`, because QoS 0 can drop messages on a broken connection.

ITEM:

```json
{"id":"ns=2;s=Line1/Speed", "parent":"ns=2;s=Line1", "name":"Speed",
 "kind":"value", "address":"ns=2;s=Line1/Speed", "path":null,
 "type":"Double", "access":"rw", "unit":"rpm", "description":"Spindle speed",
 "sample":null, "more":false, "root":null,
 "detail":{"namespace_uri":"urn:plc:line1"}}
```

- `id` (up to 512 characters) is unique within the scan. `parent` is an `id` or null. The first item of a branch scan has `id` equal to `folder_id`, and the agent sets its `parent` from the current snapshot.
- `kind` is `folder` or `value`. `address` is required for a value, must parse with the driver's own address parser, and must be in the driver's canonical form, which is the form the driver's printer produces from its parsed address.
- `type` is a Sparkplug type name from the editor's list, or null.
- `more:true` on a folder means it has children the scan did not list. `root` is what to send for a branch scan, defaulting to `id`.
- Limits: `name` 256, `address` and `path` 1024, `description` 1024, `sample` 256 characters, `detail` 2 KiB. The agent truncates longer strings and drops items with no `id` or a duplicate `id`, and counts both in `rejected`.

### Error codes

Every event has exactly one code and exactly one component that sets it.

| Code | Set by | Meaning |
|---|---|---|
| `REQUEST` | agent | The NCMD request is malformed, or `options` is over 8 KiB |
| `UNDEPLOYED` | agent | The connection is not in this agent's config, or it is not a split driver. It may not be deployed yet |
| `NODRIVER` | agent | The driver is not connected to the broker or its status is not `UP`. The message carries the status, such as `CONF` or `ADDR` |
| `LIBRARY` | agent | The driver has been `UP` for 10 s and never subscribed to `scout`, so its library predates scouting |
| `BUSY` | agent | A scan is already queued or running on this connection |
| `LIMIT` | agent | The per-agent concurrency limit is full and the queue is full |
| `NOTRUNNING` | agent | A cancel named a connection with no queued or running scan |
| `UNSUPPORTED` | library | The handler does not implement scouting |
| `OPTIONS` | library, from the handler | Bad `root`, `folder_id` or options. The message says which |
| `CONN`, `AUTH` | library, from the handler | As for driver `status`. Also `CONN` when a Rust handler's `scouter()` returns `None` |
| `CANCELLED` | library | Stopped by the operator's cancel or by a new `conf` |
| `ERR` | library | The handler threw or panicked, with the message |
| `TIMEOUT` | agent | The deadline passed, or no message arrived for 30 s |
| `LOST` | agent | A `seq` gap, so messages were dropped |
| `INTERRUPTED` | agent | The agent restarted, or the driver disconnected, left `UP` or sent a new hello during the scan |
| `STORE` | agent | Snapshot upload or status write failed, with the Files or ConfigDB status in the message |
| `AGENT` | agent | Any other agent-side failure, with the message |

A library that receives a second `start` while one is running answers it with `ERR`, which only a faulty agent can cause, because the agent allows one scan per connection and a new `conf` cancels a running scan.

A truncated scan is not an error. It ends with `truncated:true` and a reason.

### Compatibility rules

| Agent | Driver library | Result |
|---|---|---|
| old, or `SCOUT_ENABLED` off | old | Unchanged |
| old, or `SCOUT_ENABLED` off | new | No `features` key, so the library never subscribes. Nothing changes, including after a rollback from a new agent |
| new | old | The driver never subscribes. Once it has been `UP` for 10 s, scans answer `LIBRARY` |
| new | new, driver not `UP` | Scans answer `NODRIVER` with the status |
| new | new, handler without scouting | Hello says `supported:false`. Scans answer `UNSUPPORTED` |
| new | new, scouting handler | Full exchange |

A breaking change later bumps `features.scout` to 2. Libraries scout only when they recognise the value.

## Driver library API

All three libraries handle the subscription gate, the hello, batching, `seq`, the limits, pacing, a driver-side watchdog that ends the scan at `limits.seconds` even if the handler hangs, one scan at a time, cancel, cancel on a new `conf`, and turning a throw or panic into an `end` with `ERR`. A handler only produces items.

The hello answer comes from the handler class, not a live handler, so a driver whose `conf` failed still answers correctly.

Defaults and ceilings, shared by the libraries and the agent:

| Limit | Default | Ceiling |
|---|---|---|
| items | 20,000 | 50,000 |
| depth | 8 | 32 |
| seconds | 120 | 600 |
| pace_ms | 20 | (minimum 0) |
| samples | false | |

**JavaScript (`lib/js-edge-driver`).** This follows the opt-in `static typedWrites` pattern (`lib/js-edge-driver/lib/driver.js:83-89`).

```js
class Handler {
    static scouts = true;                    // default false
    /* req: { root, folder_id, options, limits }
     * out: { add(items) -> Promise, progress({visited, found, note}),
     *        signal: AbortSignal }
     * Return { exhaustive, truncated, reason, excluded },
     * or throw ScoutError(code, message). */
    async scout (req, out) { ... }
}
```

`out.add` resolves when the batch is queued, for back-pressure, and rejects at the item cap, after which the library ends the scan as truncated. `scout` is **not** put in `messageHandlers`, because `connected()` subscribes to every key there before any addr arrives (`driver.js:319-324`) and drivers may override `setupMessageHandlers`. Instead `connected()` clears a `scout_seen` flag, and the start of `setAddrs` reads `pkt.features`, subscribes to `scout` once per session, and routes `scout` messages to a dispatcher the library owns.

**Python (`lib/py-edge-driver`).**

```python
class Handler(ABC):
    scouts: ClassVar[bool] = False
    async def scout(self, request: ScoutRequest, out: ScoutSink) -> ScoutEnd:
        raise ScoutError("UNSUPPORTED")
```

`ScoutSink` has `async add(items)`, `progress(...)` and a `cancelled` `asyncio.Event`. The gate sits at the top of `set_addrs` (`driver.py:257`), with the same per-session flag as JS. No Python driver lives in this repo, so the work is the library, its tests, and a CI workflow, which does not exist today.

**Rust (`lib/rs-edge-driver`).** This mirrors `TYPED_WRITES` (`src/handler.rs:118`) and the lock-free `poller()` (`src/handler.rs:265`), so a scan never holds the handler's `Arc<Mutex<H>>` (`src/driver.rs:349`) and polls and writes carry on.

```rust
pub trait Handler {
    const SCOUTS: bool = false;                               // sent in hello
    fn scouter(&self) -> Option<Arc<dyn Scouter>> { None }     // asked per scan
}
#[async_trait]
pub trait Scouter: Send + Sync {
    async fn scout(&self, req: ScoutRequest, sink: ScoutSink)
        -> Result<ScoutEnd, ScoutError>;
}
// ScoutSink: async fn add(&self, items: Vec<Item>) -> Result<(), Stop>;
//            fn progress(&self, p: Progress); fn cancelled(&self) -> CancellationToken;
```

The fixed subscription list at `src/driver.rs:601-607` stays as it is. Addr handling subscribes to `scout` when it sees the feature and the per-session flag is clear, and the reconnect path clears the flag. The dispatch at `src/driver.rs:895-899` gains `"scout"`. `scouter()` returning `None` while `SCOUTS` is true means the handler is not connected, so the library ends the scan with `CONN`. `add` waits while the publish queue is over half full, so scan output gives way to data. `CancellationToken` comes from `tokio-util`, a new dependency of the crate.

Every library has a test that sees the feature, then reconnects to a broker with the pre-v6.8.0 ACL that sends `addr` without `features`, and asserts that the driver is never disconnected.

## Driver implementations

### edge-opcua (implement now)

The scouter holds a clone of the handler's `Arc<Session>` (`edge-opcua/src/handler.rs:85`). It opens no second session, because many PLC servers have few session slots.

- **Root.** Defaults to Objects (`i=85`). The Server object (`i=2253`) is skipped unless the root is inside it or the option `include_server` is true. When it is skipped, the `end` message reports it in `excluded` with `prefixes: ["i="]`, because almost every namespace 0 node under Objects sits inside the Server object.
- **Ids.** An item's `id` is its canonical NodeId string. Element items from `expand_arrays` use `<nodeid>[i]`.
- **Walk.** Breadth-first Browse over `HierarchicalReferences` (`i=33`), subtypes included, forward only, node class mask Object and Variable, `requestedMaxReferencesPerNode` 1000. BrowseNext follows every continuation point, and all outstanding points are released with `releaseContinuationPoints=true` on cancel, timeout, cap or error.
- **Visited set.** Keyed by the canonical NodeId string. A node reached by a second path is listed once, under the first parent, which also ends `Organizes` cycles. A branch scan can therefore list a node already listed elsewhere, and the agent's merge rule removes that duplicate.
- **Batching and pacing.** Nodes per Browse are min(`MaxNodesPerBrowse`, 50) and per Read min(`MaxNodesPerRead`, 100), read once from the server's OperationLimits and defaulting to those numbers when absent or 0. One request is in flight at a time, with `pace_ms` between requests. On `BadTooManyOperations` the batch halves and the pace doubles.
- **Attributes.** For each Variable: DataType, ValueRank, ArrayDimensions, UserAccessLevel and Description. Value only with `samples`, and EngineeringUnits only with the option `units`.
- **Types.** Boolean, SByte to Int8, Byte to UInt8, Int16 to UInt64, Float, Double, String, DateTime and Guid to UUID. Enumerations map to Int32 and LocalizedText to String. Structures, ByteString and the rest get `type:null` with `detail.ua_type`. Arrays get `type:null` and `detail.dims`. With the option `expand_arrays` (default off) arrays of up to 64 elements get element items addressed `addr[i]`, which `edge-opcua/src/addr.rs` parses.
- **Address.** The canonical form `addr.rs` prints, so namespace 0 is written `i=2258`, never `ns=0;i=2258`. The UI's `opcua` normaliser turns a metric's address into the same form before it compares (see "Re-scan and diff semantics"). `detail.namespace_uri` records the namespace URI, because an `ns=` index can change when a server is rebuilt.
- **Caps.** Each request uses `REQUEST_TIMEOUT` of 10 s (`handler.rs:66`). A folder at the depth cap gets `more:true`. `BadUserAccessDenied` on a branch gives a folder with `detail.denied`, `more:true` and reason `partial_access`.
- **Failures.** Not connected or session lost gives `CONN`, with no automatic retry. A bad root gives `OPTIONS`.

### edge-mqtt (implement now)

The old scout reused the main client id, so the broker dropped the data session. The scouter opens a **second, short-lived client** with the same host, TLS and credentials (`edge-mqtt/src/handler.rs:86-106`), clean session, no will, QoS 0. Its client id is `<clientId>-scout-<6 hex>`, or `fpscout-<12 hex>` when that would pass 23 characters, unless the option `client_id` sets it.

- **Options.** `filters` (default `["#"]`, each checked with `topics::valid_filter`), `seconds` (default 10, at most 120), `inspect_bytes` (default 64 KiB), `json_leaves` (default true) and `client_id`. Topics starting with `$` are skipped unless a filter names them.
- **Ids.** A folder for topic level `a/b` has id `a/b/`. A topic has id `a/b`. A JSON leaf has id `a/b`, a NUL character, then its JSONPath. A topic `a/b` that carries messages and also has child topics `a/b/c` therefore gets both a folder `a/b/` and a value `a/b`, and its children hang off the folder.
- **Items.** Each topic is a value with `address` set to the topic and `path` null. A folder's `root` is `a/b/#`, so a branch scan listens on that filter. `detail` holds `{count, rate_hz, retained, format}`.
- **JSON.** For payloads up to `inspect_bytes`, each leaf becomes a child of the topic's value item, with the same `address`, `path` as JSONPath (`$.a.b[0]`), and an inferred type: Int64 when every sample was an integer, else Double, then Boolean and String. Depth 8 and 200 leaves per topic.
- **Load.** Retained messages arrive in one burst after SUBACK and are analysed in full, bounded by `inspect_bytes`, the item cap and a total of 32 MiB inspected per scan. The flood cutoff counts only live messages. Above 5,000 live messages a second the scouter keeps recording topics and stops payload analysis for the rest of the window.
- **Ending.** After `seconds`, or at the item cap (truncated). When the broker's SUBACK reports failure on some filters the scan ends with reason `partial_access`, and on every filter with `AUTH`, "The broker refused every filter. Give narrower filters." Many brokers accept a subscription and filter delivery without saying so, and then the scan simply finds fewer topics. The `edge-mqtt` README says so.
- **Exhaustive** is always false.

### Every other driver

| Driver | Library | Now |
|---|---|---|
| edge-test | JS | Implement. Deterministic tree set by options (`size`, `depth`, `fail`, `hang`, `delay_ms`, `duplicates`). Conformance fixture |
| edge-test-rs | Rust | Implement, as edge-test |
| edge-sim | JS | Implement. Lists the loaded cassette's channels and its `player:*` addresses, and returns an empty, exhaustive scan with no cassette loaded. The JS reference scouter |
| edge-ads, edge-bacnet, edge-focas, edge-ftp, edge-pathfindr, edge-rtde, edge-tplink-smartplug | mixed | Default unsupported now. Later: ADS symbol upload (next), BACnet `object-list`, FTP directory walking through its `list:<dir>` addresses (`dumps/edge-ftp.yaml`), FOCAS and fixed catalogues, Pathfindr's asset API |
| edge-modbus, edge-rest, edge-udp, edge-openprotocol | mixed | Unsupported by design. The protocol has nothing to list |
| Drivers outside this repo | any | `LIBRARY` until rebuilt on a new library, then whatever they implement |

## Edge Agent changes

- **`lib/devices/driver.ts`**
  - Add `features: {scout: 1}` to the `addr` packet (`:429-436`) when `SCOUT_ENABLED` is on.
  - Exempt `found` from the data flush at `:342`. Every non-data message flushes today, so without this every items batch would split DDATA groups during a scan.
  - Add `scout` to the looped-message cases (`:350-357`), so the agent does not log "Unexpected scout message" for its own publishes.
  - Route `found` to the `ScoutManager`. Send `cancel` for a running scan before a new `conf`.
- **`lib/driverBroker.ts`**: the ACL additions, the scout subscriber map with `scouts(id)`, and the test-only `acl` option.
- **`lib/sparkplugNode.ts`**: when `SCOUT_ENABLED` is on, an NBIRTH metric `Node Control/Scout` (String, `""`) beside the others (`:168-182`), and an NCMD case beside `:386` that parses the JSON and emits `scout`. Bad JSON is logged and ignored.
- **`lib/translator.ts`**: delete the old branch at `:410-415`, construct the `ScoutManager`, and wire `sparkplugNode.on("scout")`. `translator.connections` is keyed by connection type (`:396`), so it holds only the last `Driver` connection, and `DriverConnection` stores no connection UUID (`driver.ts:86-97`). `setupConnection` therefore registers each connection with the `ScoutManager` under its UUID. `Translator.stop` awaits `ScoutManager.stop()`, which cancels running scans and finishes their status writes before an in-process reload starts the new `init()`.
- **New `lib/scout.ts`, `ScoutManager`.** Constructor takes `{ fplus, broker, translator }`, house style with snake_case methods. It:
  - keeps its own map from connection UUID to `DriverConnection`
  - keeps a state machine per connection: idle, queued, running, saving
  - allows `SCOUT_MAX_CONCURRENT` (default 1) scans per agent, one per connection, with a queue of 4
  - runs a 30 s silence timer and a deadline of `seconds + 15` s, which both send `cancel` and end the scan with `TIMEOUT`
  - validates every message and item against the JSON Schemas with precompiled ajv validators, detects `seq` gaps, and drops duplicate ids
  - streams items as NDJSON lines through `zlib.createGzip()` into an in-memory buffer, and stops at `SCOUT_MAX_BYTES` (default 32 MiB uncompressed) or `SCOUT_MAX_GZ_BYTES` (default 8 MiB compressed), reason `size`
  - yields to the event loop between batches, so DDATA handling is never queued behind a batch
  - creates the File object and uploads the finished Buffer with `fplus.Fetch`, as `fileRequest` does (`translator.ts:211-268`). It never uploads a stream, because `fplus.Fetch` retries once on 401 by sending the request again (`lib/js-service-client/lib/service/fetch.js:349-353`) and a stream would already be used up. Files 403, 404 and 409 become `STORE` messages that name the cause
  - for a branch scan, streams the current snapshot twice: once to build the map of ids to parents, then again to copy every line outside the replaced subtree, so it never holds the parsed snapshot
  - keeps `current` and `previous`, and deletes the snapshot that drops out
  - throttles status writes to one every 2 s, and writes the hello result only when it changes
  - on `init()`, reads the status entries for its connections, rewrites `queued` or `running` as `failed` with `INTERRUPTED`, and deletes the in-flight snapshot object. A driver disconnect, a status other than `UP`, or a new hello during a running scan does the same
- **Environment.** `SCOUT_ENABLED` (default off until the release that ships the Admin UI, then on), `SCOUT_MAX_CONCURRENT`, `SCOUT_MAX_BYTES` and `SCOUT_MAX_GZ_BYTES`, set through the edge-agent chart.
- **Memory and CPU.** The edge-agent chart limits the agent to 100m CPU and 200Mi (`edge-helm-charts/charts/edge-agent/values.yaml:65-67`). A scan holds at most the gzip buffer (8 MiB) and, during a branch merge, the id map (a few MB for 50,000 items). The end-to-end tests measure both and the DDATA latency during a scan (see "Test plan").
- **Logging.** Every state change and failure goes to stderr at the default level, not only to DEBUG. With `SCOUT_ENABLED` off the `ScoutManager` writes nothing and logs one line at start-up.

## Result storage, size limits and retention

**Why Files.** ConfigDB caps bodies at 100kb (`deploy/values.yaml:177`, `lib/js-service-api/lib/webapi.js:28`), which holds a few hundred plain items. Files allows 3gb (`deploy/values.yaml:218`), needs an existing object of class File before upload, and refuses to overwrite (`acs-files/lib/api-v1.js:155-161`), which suits immutable snapshots.

**Status entry.** App `Edge.App.ScoutStatus`, keyed by the connection UUID, at most 16 KiB, written only by the agent. The ConfigSchema enforces the limit with `maxLength` on every string and `maxItems` on `branches`, `excluded` and `prefixes`.

```json
{"version":1, "node":"<agent node uuid>", "supported":true,
 "scan":"<uuid>", "request":"<uuid>", "state":"queued|running|done|failed|cancelled",
 "code":null, "message":null, "started":"...", "updated":"...", "finished":"...",
 "root":null, "folder_id":null, "options_hash":"sha256:...", "config_hash":"sha256:...",
 "progress":{"visited":9100, "found":3420, "note":"..."},
 "last_request":{"request":"<uuid>", "code":"BUSY", "message":"...", "at":"..."},
 "current":{"file":"<uuid>", "items":9812, "bytes_gz":402113, "exhaustive":true,
            "truncated":false, "reason":null, "finished":"...", "root":null,
            "options_hash":"...", "config_hash":"...",
            "excluded":[{"id":"i=2253","reason":"skipped","prefixes":["i="]}],
            "branches":[{"folder_id":"...", "finished":"..."}]},
 "previous":{...same shape...}}
```

- `supported` is `true`, `false`, `"library"` or null when not yet known.
- The scan fields (`scan` to `progress`) describe the latest accepted scan only. A refusal never touches them. It goes in `last_request`, which the UI matches against its own request UUID. An accepted request also sets `last_request` with `code` null.
- `options` is kept only in the snapshot, and the entry holds its hash.
- `branches` keeps the last 20 branch scans. `excluded` keeps at most 20 scopes with at most 8 prefixes each.
- `message` and `progress.note` are at most 512 characters, `root` and `folder_id` at most 1024.
- `config_hash` hashes the connection's driver details without secrets, so the UI can say a snapshot predates a settings change.

**Snapshot.** gzip of NDJSON. The first line is a header `{"version":1, "scan", "connection", "driver", "started", "root", "folder_id", "options"}`, each following line is one ITEM, and the last line is `{"end":{"finished", "exhaustive", "truncated", "reason", "excluded", "rejected", "items", "branches"}}`. A reader treats a snapshot with no `end` line as invalid. A 20,000-item OPC UA scan is about 6 to 12 MB raw, because NodeIds repeat in `id`, `parent` and `address`, and an estimated 0.6 to 1.2 MB gzipped. The build measures both with the `server.cjs` SCOUT mode before the defaults are fixed.

**Retention.** Each connection keeps `current` and `previous`, and only those two count as references. A failed or cancelled scan leaves both alone and deletes its own File object. To delete a snapshot, the agent first calls the new Files `DELETE /v1/file/:uuid`, which needs the object to exist for its class-based permission check, and then deletes the ConfigDB object. `DELETE` succeeds when there is no content, because the object is created before upload and a failed scan never uploads. Deleting a connection removes its status entry, because ConfigDB deletes an object's configs with it (`acs-configdb/lib/model.js:573-615`). A service-setup fixup sweeps `Edge.Class.ScoutResult` objects that no `current` or `previous` references and that are more than a day old, so orphans go away on the next upgrade without a hand-run script and a running scan is never swept.

## Triggering and permissions

New UUIDs, made with `uuidgen` during implementation, go in `acs-service-setup/lib/uuids.js`, `lib/js-service-client/lib/uuids.js` and `acs-edge/lib/uuids.ts`. Do not reuse `f8c1b13b-…`.

| UUID | What |
|---|---|
| `Edge.App.ScoutStatus` | App "Edge scout status", `subclassOf MetaDB.Class.ConfigEntry` |
| `Edge.Class.ScoutResult` | "Edge scout result", `subclassOf Files.Class.File`, `memberOf Files.Class.FileGroup`, copying `Edge.Class.DeliveryFile` (`acs-service-setup/dumps/edge-ftp.yaml:27-33`) |
| `Edge.Perm.Scout` | "Scan device addresses", member of `ACS.PermGroup.CmdEsc` |
| `Files.Perm.Delete` | New Files permission, member of `Files.Perm.All` |

Dump changes:

- **`dumps/edge.yaml`**: the app, class and perm, the ConfigSchema for the status app, and a `scout` key on the DriverDefs for OPC-UA, MQTT, Test and Test (Rust), documented in the comment block at `:72-101`. The Simulator DriverDef lives in **`dumps/edge-sim.yaml`** (`:36`) and gets its key there.

  ```yaml
  scout:
    title: "Scan the server's address space"
    address_form: opcua          # UI normaliser: opcua, mqtt or exact (default)
    options: { type: object, properties: { root: { type: string } } }
  ```

  A missing `scout` key means "show the panel and trust the hello", which covers `ACS.Driver.External` and drivers outside this repo. `scout: false` hides the panel. Exhaustiveness is reported by each scan and is not part of the DriverDef.

- **`dumps/acs-v2.yaml`**: a `CmdEsc.App.CmdDef` entry `Edge.Perm.Scout: [{name: "Node Control/Scout", type: String}]`, following `:124-132`.
- **`dumps/helm.yaml`**: grants for `Local.Role.EdgeAgent` beside `:263-272`. These must live here, because only one dump may grant to a principal.

  ```yaml
  !u ConfigDB.Perm.ReadConfig:  { !u Edge.App.ScoutStatus: false }
  !u ConfigDB.Perm.WriteConfig: { !u Edge.App.ScoutStatus: false }
  !u ConfigDB.Perm.CreateObject: { !u Edge.Class.ScoutResult: false }
  !u ConfigDB.Perm.DeleteObject: { !u Edge.Class.ScoutResult: true }
  !u Files.Perm.Upload:   { !u UUIDs.Special.Null: false }   # checked against Null, api-v1.js:96-103
  !u Files.Perm.Download: { !u Edge.Class.ScoutResult: true }
  !u Files.Perm.Delete:   { !u Edge.Class.ScoutResult: true }
  ```

  The existing `Files.Perm.Download` on `Edge.Class.DeliveryFile` merges into the same key.

- **`acs-files`**: a `DELETE /:uuid` route in `setup_routes` (`acs-files/lib/api-v1.js:27-33`), served as `DELETE /v1/file/:uuid` because the router is mounted at `/v1/file` (`acs-files/lib/routes.js:7`). It checks `Files.Perm.Delete` against the file UUID, so class grants apply, removes any stored content, and answers 204 whether or not content existed.

Administrators already hold `ACS.PermGroup.CmdEsc`, ConfigDB and `Files.Perm.All` (`acs-service-setup/dumps/admin.yaml:100-104`), so they can scan and read results with no new grant. The UI checks the Scout permission the way `useCanRebirth.js` does and disables Scan with the reason.

**Fixups** in `acs-service-setup/lib/fixups.js`, in the style of `delete_old_entries` (`:28`):

- Strip `scout` from every connection in `Edge.App.AgentConfig`. `applyConnection` updates entries in place and keeps unknown keys (`edgeAgentConfigUpdater.js:63-79`), so the dead key would otherwise stay forever.
- Sweep orphaned `Edge.Class.ScoutResult` objects, calling Files `DELETE` before deleting each ConfigDB object.

## Admin UI design

### Layout

`OriginMapEditor.vue` has the schema tree sidebar and the metric pane (`SidebarInset`, `:101-145`). Add a third, right-hand panel, **Addresses**, opened from a header button beside the `actions` slot (`:123`) that shows the item count. It is resizable and collapsible, with its width remembered in localStorage, and becomes a sheet over the metric pane below `lg` widths. The operator reads left to right: schema, metric, discovered address. The panel is hidden when the DriverDef has `scout: false`.

### Components

Under `OriginMapEditor/Scout/`:

- `ScoutPanel.vue`: state view and header ("9,812 addresses, scanned 24 Nov 10:42") with Scan or Re-scan, Stop, and an options form from `driverDef.scout.options`.
- `ScoutTree.vue`: a virtualised tree with fixed 28 px rows on `@tanstack/vue-virtual` at an exact pinned version. Columns are name, address in monospace, type, access, sample, a mapped-to chip and a change badge.
- `ScoutChangeBar.vue`: counts and filters for New, Changed, Not seen, and Mapped but missing.
- `ScoutMapDialog.vue` (phase 2): bulk mapping.
- `src/composables/useScout.js`: state, `start`, `cancel` and `load`, over `CmdEsc.request_cmd`, `ConfigDB.watch_config` (`lib/js-rx-client/lib/configdb.js:36`), and the node's births and deaths through `SparkplugApp`, as `useCassetteDecks.js` does.
- `src/lib/scout/model.js`: pure functions with no Vue or DOM, like `contract.js`, for parse, validate, index, search, diff, address normalisers, usage and auto-match.
- `src/lib/scout/worker.js`: gunzip, NDJSON parse and indexing off the main thread.

### States

The panel works out its state in this order, and the first match wins.

| State | When | What the operator sees |
|---|---|---|
| Hidden | DriverDef `scout: false` | No panel |
| Agent offline | No NBIRTH since the last NDEATH | "The Edge Agent is offline, so it can't scan." Any previous snapshot stays browsable |
| Agent too old | Online, and NBIRTH has no `Node Control/Scout` | "This Edge Agent can't scan. Upgrade ACS, or turn scanning on for this agent." |
| Untrusted | The status entry's `node` is not this connection's node | Nothing from the entry, and why |
| Not deployed | `UNDEPLOYED` in `last_request`, or the connection is not in the agent's saved config | "Save and deploy this connection before scanning it." |
| Unsupported | `supported:false` | "The Modbus driver can't list its addresses. Type them in the metric panel." |
| Driver too old | `supported:"library"` | "This driver was built before scouting. Update the driver image." |
| Driver not running | `NODRIVER` | "The driver isn't ready" with the status it reported, such as a config or address error |
| No permission | No `Edge.Perm.Scout` | Scan disabled: "Needs the Scan device addresses permission." Existing snapshots stay browsable |
| Never scanned | No `current` | What a scan does, that data collection carries on, the options, and Scan |
| Waiting | A request was sent, and neither `request` nor `last_request.request` matches it after 15 s while the node is online | "The Edge Agent didn't record the request. Its log says why, and a missing grant is the usual cause." |
| Refused | `last_request` matches this browser's request with a code | The plain-words reason for `BUSY`, `LIMIT`, `REQUEST` or `NOTRUNNING`. `BUSY` offers to follow the running scan |
| Queued, Running | `state` is `queued` or `running` | Live count, elapsed time and Stop. The previous snapshot stays browsable under a banner |
| Done, empty | `done` with 0 items | "The scan found no addresses." For MQTT: "Nothing was published in the 10 s window." For a simulator: "Load a cassette first." |
| Done | `done` | The tree. A truncated banner names the cap and suggests a branch scan. A stale banner shows when `config_hash` differs |
| Failed, Cancelled, Interrupted | `failed` or `cancelled` | The plain-words message for the code, any previous snapshot, and Try again |

### Browsing and binding

- Search covers name, address, path, description and unit, with a 150 ms debounce. Matches show their ancestor path and a count.
- Filters: Values only, Not mapped (across every device on this connection), New since last scan, Writable, and Type.
- Every drag has a keyboard equivalent, and Enter uses the item for the selected metric.
- **Pick from scan** sits next to the Address input (`SparkplugMetric.vue:48`). Clicking an item, pressing Enter, or dragging a row onto a metric in the schema tree fills `Address` and `Path`, `Sparkplug_Type` when unset and allowed, and `Eng_Unit` and `Documentation` only when empty.
- **Editing path.** A drop target may be a schema metric with no origin map entry yet. An `ensure_metric(path)` helper, pulled out of `selectMetric` (`OriginMapEditor.vue:741-822`), creates the entry with its defaults and stamps `Schema_UUID` and `Instance_UUID` up the chain. Values then go through `validate_proposal` and `apply_proposal` (`acs-admin/src/lib/driver-ui/contract.js:262`, `:315`) **in place** on that object, because the editor identifies metrics by object identity and that file records that replacing the object loses the edit. The helper then calls `markDirty` and bumps `rerenderTrigger` and `groupRerenderTrigger`, because a metric that is not selected has no `SparkplugMetric` instance to emit `input`. Nothing saves on its own.
- **Reverse view.** Selecting a metric reveals its address in the tree. When the metric meets the "Mapped but missing" rule, the metric pane shows "Not found in the scan of 24 Nov".
- **Folder rows** offer "Scan this branch".
- **Bulk mapping** (phase 2). Select items, then Map selected. The dialog proposes a metric per item by normalised name (lowercase, letters and digits only), tie-broken by parent path and then type. Each row is matched, ambiguous, type conflict, or no metric. For a `patternProperties` target it offers "Create n objects named after the items" through `createObject`. Apply reuses the CSV import path (`applyCsvToModel` and `updateDynamicSchemaObjects`, `OriginMapEditor.vue:1095-1140`), which already handles bulk creation, dirtiness and re-rendering.

Items come from the device, so the UI treats every string as untrusted text and never renders it as HTML.

### Driver custom UIs: contract version 2 (phase 2)

When a DriverDef has a `ui` document, `SparkplugMetric.vue` renders `DriverCustomUI` in place of the standard fields (`v-if="showCustomUI"`, `:11`), so the Pick button is not there. Phase 1 shows the Addresses panel beside the custom UI, and the operator copies an address from it. Contract version 2 closes that gap in phase 2 and stays additive:

- `ui_document` (`contract.js:95`) and `parse_message` (`:199`) accept versions 1 and 2 in place of `CONTRACT_VERSION = 1` (`:27`), and the host answers each document in its own version. Version 1 documents, such as Pathfindr's, are unchanged.
- The shell `acs-admin/public/driver-ui/host.html` accepts only envelope version 1 for its `document` message (`VERSION = 1`, `:34`). The shell stays on version 1, and only the messages between host and document use version 2.
- `init.scout = {available, state, finished, items}` tells the document whether a snapshot exists, and a host-to-document `{type:"scout-changed", scout:{...}}` message, with the same shape, tells it when a scan starts, finishes or fails.
- Document to host `{type:"pick-address", filter?:{prefix, kind}}` opens the host's own picker over the iframe. The host replies `{type:"picked", item}` with the item, minus `sample` unless the DriverDef opts in, and the document then uses `propose` as today, under the same `PROPOSABLE` allowlist (`contract.js:52-62`).
- Document to host `{type:"scout-query", prefix, limit}` with a limit of at most 500 answers `{type:"scout-items", items}`, so a document can draw its own list.
- The document cannot start a scan. Third-party code in the sandbox never causes load on production equipment.

No driver in this repo has a version 2 document yet, so phase 2 also adds a version 2 test document under `acs-admin/tests/fixtures/driver-ui/` and a browser test that drives it.

## Re-scan and diff semantics

- **Address normalisers.** Before any comparison, the UI puts a metric's `Address` into the driver's canonical form with the normaliser named by the DriverDef's `scout.address_form`. `opcua` strips `ns=0;` and reduces an index range such as `node[2:5]` (`edge-opcua/src/addr.rs:72-91`) to its base node, unless the snapshot has an element item for that exact address. `mqtt` and `exact` compare unchanged. Normalisers are built into `model.js`, so no code comes from ConfigDB.
- **Identity** is `address + "\0" + (path ?? "")`. Folders without an address match by `id`.
- **New**: in the current snapshot and not the previous. **Changed**: same identity, different `type`, `access`, `kind` or `detail.dims`. A different `name` shows as "renamed".
- **Comparable.** Two snapshots are comparable when both are exhaustive, neither is truncated, their `options_hash` and `root` match, and their `excluded` scopes match. **Gone** is shown only between comparable snapshots. Otherwise absent items show as "Not seen this time", or the change bar says the options differ. MQTT scans are never exhaustive, so they never report Gone.
- **Mapped but missing** lists metrics in this device's origin map whose normalised (Address, Path) is absent from the current snapshot, when the current snapshot has `root` null, is exhaustive and is not truncated, and the address is not placed inside a skipped part of the scan. An address is inside a skipped part when it starts with a prefix of an `excluded` scope. When the snapshot has any `excluded` scope without prefixes, or any folder with `more:true` or `detail.denied`, unfound addresses that no prefix places show as "Not seen" instead, because the scan cannot say where they would be. A mapped metric whose type conflicts with the discovered type gets a warning chip.
- **Branch scan merge.** The agent takes the current snapshot and the branch scan's items and:
  1. removes the folder whose `id` is `folder_id`, and every item whose parent chain in the current snapshot reaches it
  2. adds the branch scan's items, giving the first one (id `folder_id`) the parent the folder had
  3. drops any added item whose `id` is still present outside the removed subtree, keeping the outside copy, which removes OPC UA nodes that a second parent lists again
  4. sets the merged `exhaustive` to the AND of both scans, `truncated` to the OR, `excluded` to the union, `options_hash` and `root` to the base snapshot's, and appends `{folder_id, finished}` to `branches`
  The change bar after a branch scan covers only that subtree. A `folder_id` that is not in the current snapshot ends the scan with `OPTIONS` before the driver is asked. The MQTT folder ids end in `/`, so the merge never confuses a folder with the topic of the same name.
- **Cancelled or failed** scans do not replace `current`.
- **Never automatic.** A scan never edits the origin map.

## Removal list

| Path | Action |
|---|---|
| `acs-edge/lib/translator.ts:410-415` | Delete the "Edge Scout is not available" branch |
| `acs-edge/docs/edge-split.md:18-19`, `:682-689` | Replace with the new Scouting section, and update the summary table and the ACL table (`:224-225`) |
| `docs/architecture/edge-management/edge-scout.md` | The first build PR moves this design to `docs/plans/edge-scout.md`, which is not in the public navigation, and deletes this path. The docs PR writes the operator and architecture guide back here |
| `docs/assets/edge-agent-scout/acs-edge-scout-high-level-diagram.png` | Delete, with its directory |
| `docs/index.md:13`, `docs/architecture/edge-management/overview.md:218`, `edge-bootstrap.md:280`, `edge-deployments.md:430` | Remove the "Learn about the edge scout mode" links in the first build PR, and add links to the new guide in the docs PR |
| `deviceConnections[].scout` in stored AgentConfig entries | Removed by the service-setup fixup |
| ConfigDB app `f8c1b13b-ebaf-45c9-b712-9cd712695513` | Never created on dev, so nothing to delete. Only the old doc mentioned it |
| `origin/za/scout` | Not merged. Tell amrc-za and close it |

The old `Scout` class and `scoutAddresses` methods went with ACS 7. Keep the unrelated Gateway Depot scout (`acs-gateway-depot/lib/depot.js:84`).

## Test plan

### Validation

- JSON Schemas for the `addr` features key, the scout requests, the found messages, ITEM, the status entry and the snapshot lines live in `lib/edge-scout-schemas/`, under `lib` because every service image is built with `lib` as a build context (`mk/acs.docker.mk:11`) and the service-setup image cannot read `acs-edge/`. The service-setup dump carries a copy of the status schema in `dumps/edge.yaml`, and a service-setup test fails when the copy and the file differ, in the style of `edge-pathfindr/test/ui-sync.test.js`.
- Shared fixtures in `lib/edge-scout-schemas/fixtures/{valid,invalid,merge}/*.json` are loaded by the agent tests, all three library tests and the acs-admin model tests, so every implementation agrees on the same files. The `merge` fixtures cover a full scan, a branch scan, a node listed under two parents, an MQTT topic that is also a folder, and the expected merged flags. Libraries validate their own output with ajv (JS) or jsonschema (Rust and Python, test-only).

### Unit tests

- **acs-edge** (jest, `acs-edge-tests.yaml`), new `tests/lib/scout.test.ts`: validation and clamping, each compatibility row including the 10 s `LIBRARY` wait and `NODRIVER` for each driver status, the state machine with fake timers (silence, deadline, cancel, `LOST`, `INTERRUPTED`, cancel on `conf`), refusals written only to `last_request`, the hello written only on change, concurrency, `seq` gaps, duplicate ids, caps, the merge fixtures, retention and the in-flight delete on `init()`, `STORE` mapping, upload from a Buffer across a 401 retry, `Translator.stop` waiting for the manager, and `found` not flushing data groups. Extend `tests/lib/driverBroker.test.ts` for the ACL, the subscriber map and the `acl` option.
- **Libraries**: `lib/js-edge-driver/test` (`node --test test/`), `lib/rs-edge-driver/tests/scout.rs` with the `FakeAgent` in `tests/common` (`rust.yaml`), and `lib/py-edge-driver/tests/test_scout.py`. Each covers the gate (feature read before the handler, version and address checks, a bad address map still subscribing), the reconnect to an old-ACL broker without a disconnect, hello from the class, batch splitting, caps, the watchdog with a hung handler, a second `start` giving `ERR`, cancel and cancel on `conf`, a throw or panic giving `ERR`, and the default `UNSUPPORTED`. Rust also proves a poll and a write complete during a running scan, and that `scouter()` returning `None` gives `CONN`.
- **edge-opcua**: DataType mapping, canonical NodeId strings, the visited set, the `excluded` report for the Server object, and backoff on `BadTooManyOperations` against a mocked session.
- **edge-mqtt**: the id scheme including a topic that is also a folder, JSON leaf paths, type inference, `$` filtering, retained messages left out of the flood rate, and scout client id derivation.
- **acs-admin** (vitest): `scout-model.test.js` for NDJSON decode, a snapshot with no `end` line, hostile strings, invalid items dropped, search, the normalisers, the comparable rule, mapped-but-missing with and without `excluded` prefixes, and auto-match. `useScout.test.js` for every row of the states table with fake CmdEsc, watch, births and Files, including a refusal in a second browser not disturbing the first. An editor test for `ensure_metric` and in-place apply on a metric that is selected, one that is not, and one with no origin map entry yet, checking object identity and dirtiness.
- **acs-service-setup** (`service-setup-tests.yaml`): the dumps load, the new UUIDs are unique, `Edge.Perm.Scout` is in `PermGroup.CmdEsc`, the agent grants sit only in `helm.yaml`, the status schema copy matches `lib/edge-scout-schemas`, and the fixup strips `scout` and sweeps only unreferenced, day-old objects in the right order.
- **acs-files**: acs-files has no tests today (its `test` script only prints "no test specified"), so this adds a `node --test` harness with a stub auth client and a temporary storage directory. The tests cover the DELETE route's permission check, removal of content, 204 with no content, and the existing upload's 409.

### Integration against a real OPC UA server

`edge-opcua/tests/server/server.cjs` gains a `SCOUT=1` mode: a 5,000-node tree 6 deep, a folder of 2,500 children with low `MAX_REFS_PER_NODE` to force BrowseNext, an `Organizes` cycle, a node reachable from two parents, a node denied to user `test`, an array, `MaxNodesPerBrowse` 10, `BROWSE_DELAY_MS`, and a count of open continuation points. New `edge-opcua/tests/scout.rs`, on `tests/support`, asserts the exact item set with no duplicates, `more:true` at depth, truncation at the caps, the Server object in `excluded`, cancel within 1 s with continuation points back to 0, `partial_access`, `CONN` after a server restart, and that `T/Counter` data keeps its normal rate during a scan. It also records item and snapshot sizes for the storage estimate. It runs in `.github/workflows/edge-opcua.yaml`, which already sets up node-opcua.

### Integration against a real MQTT broker

First, a spike against mosquitto 2.x with an `acl_file` (`edge-mqtt/tests/real/mod.rs` accepts extra config) records how the broker answers a denied `#` and a partly denied tree. The assertions follow what it records: `AUTH` and `partial_access` are asserted only where mosquitto reports SUBACK failures, and otherwise the test asserts that denied topics are simply absent.

New `edge-mqtt/tests/scout_mosquitto.rs`, on `tests/real`, then covers retained and live topics, a topic that is also a folder, JSON leaves, binary payloads, `$SYS` exclusion, the ACL cases from the spike, the caps, a retained burst of 10,000 topics that keeps its JSON leaves, the live flood cutoff, and that the main session never reconnects and keeps receiving during the scan. It runs in `split-driver-golden.yaml` with `EDGE_MQTT_MOSQUITTO=1` (`:60`).

### End to end

New `acs-edge/tests/scout/e2e.test.ts` on `tests/golden/harness.ts` runs the real `Translator` and `DriverBroker` with the built edge-opcua and edge-mqtt binaries, stub ConfigDB, Files and cmdesc in `tests/stubs`, and an injected NCMD. It asserts the status sequence, a schema-valid snapshot, a branch merge, a re-scan change list, retention, and a refusal that leaves a running scan intact. Compatibility cases use the broker's `acl` option: a new driver against both the **pre-v6.8.0** ACL (`status|data/\w+|err/\w+`, `active|conf|addr|cmd/#|poll`) and today's, never disconnected, a rollback from a new agent to an old ACL, and the edge-test driver giving `LIBRARY` with the feature handling off and `UNSUPPORTED` with `scouts` false.

A load case runs a 50,000-item edge-test-rs scan while edge-test publishes data, with the agent process held to 100m CPU and 200Mi as the chart sets them, and records DDATA latency and peak memory beside the "Gathering data" table in `edge-split.md`. The test fails when the 95th percentile latency more than doubles or memory passes 180Mi.

The test is skipped unless `SCOUT_E2E=1` is set, and it writes a marker file that the CI step checks afterwards, so a skip cannot pass silently, as the golden harness does with its driver binary. It runs in a new `scout-e2e.yaml` workflow, because no existing job has both driver binaries, node-opcua and mosquitto: `split-driver-golden.yaml` builds one driver per matrix leg, and `acs-edge-tests.yaml` runs `npx jest --ci` with no binaries.

Before merge, a manual pass on a dev cluster checks every panel state, two browsers, a non-admin user, an offline agent and an old agent.

### CI workflows

`js-lib.yaml` is the npm publish workflow, not a test workflow, and several suites run nowhere today. The build adds:

- `js-edge-driver-tests.yaml`: `node --test test/` in `lib/js-edge-driver`
- `py-edge-driver.yaml`: pytest in `lib/py-edge-driver`
- `acs-admin-tests.yaml`: the vitest suite
- `edge-js-drivers.yaml`: the tests of edge-test and edge-sim
- `acs-files-tests.yaml`: the new acs-files harness
- `scout-e2e.yaml`: the end-to-end and load tests

## Docs plan

- This page, rewritten after the build as the operator and architecture guide, with a Mermaid sequence diagram, storage, permissions, `SCOUT_*` variables, troubleshooting by error code, and the driver support table.
- `acs-edge/docs/edge-split.md`: features key, the per-session gate, topics, ACL, messages, codes, compatibility, and the rule never to subscribe to a new topic without a feature flag.
- `docs/architecture/edge-management/driver-custom-uis.md`: contract version 2, in phase 2.
- The three library docs (`lib/js-edge-driver/docs/driver.md`, `lib/py-edge-driver/README.md`, `lib/rs-edge-driver/README.md` and rustdoc) and `docs/development/rust-drivers.md`: "Adding scouting", with edge-sim and edge-test-rs as examples, the id rules, and `excluded`.
- `edge-opcua/README.md` and `edge-mqtt/README.md`: options, caps, device load, and the MQTT broker ACL behaviour found by the spike.
- An operator how-to, "Map a device from a scan", with screenshots, and a `## Release notes` section in the PR covering the permission, grants, `SCOUT_ENABLED`, and that agent and driver both need this release.

## Risks and open decisions

1. **Load on production equipment.** A full browse of a busy PLC server, or `#` on a plant broker, is real load. Pacing, backoff, server operation limits, samples off and a 10 s MQTT window keep it down, and sites can lower the caps.
2. **Load on the Edge Agent.** The agent runs at 100m CPU and 200Mi. One scan at a time, a bounded gzip buffer, a streamed merge and the load test keep it inside that, and the defaults change if the measurement says so.
3. **Files Upload is global.** Files checks Upload against `Special.Null` (`acs-files/lib/api-v1.js:96-103`), so an agent could fill any empty File object. A later Files change can check the object's class.
4. **Files is unowned code**, so the DELETE route stays small and gets the first tests acs-files has had.
5. **Schema pin.** The `Node Control/Scout` NBIRTH metric may need an acs-schemas release and a `values.yaml` tag bump to reach sites. The work breakdown includes it.
6. **OPC UA namespace indexes** can change after a server rebuild. `detail.namespace_uri` records the URI, and `nsu=` addresses are a later change.
7. **MQTT broker behaviour.** Many brokers filter denied topics silently instead of failing the SUBACK, so a scan under a narrow ACL can look complete when it is not. MQTT scans are never exhaustive, so the UI never calls anything gone or missing because of it.
8. **MQTT client id.** A broker with strict client-id ACLs may refuse `<clientId>-scout-...`, so the options allow `client_id`.
9. **Estimates.** The snapshot sizes and the Admin UI estimate are the least certain numbers here. Sizes are measured early, in step 7.
10. Cross-agent writes, UI scope, device-less connections and the OPC UA Server object are decisions 3, 5, 6 and 7.

## Work breakdown

| # | Work | Days |
|---|---|---|
| 1 | Removal, docs navigation, protocol text, `lib/edge-scout-schemas` and shared fixtures | 2 |
| 2 | Service-setup UUIDs, dumps, grants, schema copy and sync test, fixups, Files DELETE route, acs-files test harness | 4 |
| 3 | acs-schemas release and `values.yaml` tag bump for the NBIRTH metric | 0.5 |
| 4 | Agent: `SCOUT_ENABLED`, ACL and test seam, features, flush exemption, NCMD, NBIRTH, `ScoutManager`, Files and ConfigDB, streamed merge, retention, recovery, tests | 6 |
| 5 | rs-edge-driver `Scouter`, sink, per-session gate, watchdog, tests | 3 |
| 6 | js-edge-driver and py-edge-driver, tests | 4 |
| 7 | edge-opcua scouter, `excluded`, server.cjs mode, integration tests, size measurement | 4.5 |
| 8 | edge-mqtt scouter, broker ACL spike, mosquitto tests | 3.5 |
| 9 | edge-test, edge-test-rs, edge-sim scouters | 1.5 |
| 10 | Admin UI phase 1: composable with births, worker, panel, tree, every state, pick, drag with `ensure_metric`, reverse view, normalisers, diff | 10 |
| 11 | CI workflows for js-edge-driver, py-edge-driver, acs-admin, JS drivers and acs-files | 2 |
| 12 | End-to-end harness, compatibility cases, load measurement, `scout-e2e.yaml` | 4 |
| 13 | Docs, including the how-to and screenshots | 3 |
| 14 | Dev-cluster trial, review fixes, `SCOUT_ENABLED` default turned on | 2 |
| | **Phase 1 total** | **about 50 days** |
| 15 | Admin UI phase 2: bulk map, auto-match, `createObject`, through the CSV path | 3 |
| 16 | Driver UI contract version 2, `scout-changed`, test document and browser test | 2 |

Order: 1, then 2 and 3, then 4 with 5, then 6, 7, 8 and 9 in parallel, then 10, 11 and 12, then 13 and 14. Step 2 lands the UUIDs, dumps, grants and Files route before the agent exists, so the agent never runs without the objects and grants it writes to. Each step can merge on its own because `SCOUT_ENABLED` stays off until step 14, so no agent advertises the feature, adds the NBIRTH metric or writes a status entry before the UI that uses them ships.
