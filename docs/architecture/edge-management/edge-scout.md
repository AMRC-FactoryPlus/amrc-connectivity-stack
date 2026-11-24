# Edge Scout design

Status: built, 24 November 2026. This page is the design of Edge Scout, updated to describe what was built. Where the build differed from the agreed design, the text says so, and "Known gaps" lists what is still open. Line references marked with a file and line number are to `dev` at `a01b9e88`, before the build. This page replaces the old Edge Scout draft, which described a design that ACS 7 removed.

Other pages cover the same feature for other readers:

- [Scanning a device for addresses](edge-scout-scanning.md), the operator guide, with every panel state and message
- [Edge Scout driver notes](edge-scout-driver-notes.md), what each driver finds
- [Adding scouting to a driver](edge-scout-drivers.md), for driver authors in JS, Python and Rust
- [Edge Scout reference](edge-scout-reference.md), the formats, codes, UUIDs, grants, settings and the Files `DELETE` route
- [Driver-supplied configuration UIs](driver-custom-uis.md#contract-version-2-edge-scout), contract version 2

## Summary

Edge Scout asks a running driver to list the addresses its device offers, so an operator can pick addresses in the origin map editor instead of typing them. Every driver takes part through its driver library. A driver either implements scouting or answers that it cannot, and the Edge Agent can tell a driver built on an old library apart from both, so the UI can always say why a scan is not available.

- **Trigger.** The Admin UI sends the node command `Node Control/Scout` through the Command Escalation service, the route `RebirthButton.vue:44` already uses.
- **Negotiation.** The Edge Agent adds a `features` key to the `addr` packet, and a driver subscribes to the new `scout` topic only after it sees that key on the current MQTT session, so a new driver never touches a topic an old agent would refuse.
- **Protocol.** Requests go on `fpEdge1/<Conn>/scout` and the driver streams answers on `fpEdge1/<Conn>/found/<id>`.
- **Storage.** The agent writes each scan as a gzipped NDJSON snapshot to the Files service, in a File object it creates, and keeps a small per-connection status entry in ConfigDB that the UI watches.
- **Editor.** A side panel shows the discovered tree beside the schema tree. The operator applies, drags or bulk-maps addresses onto metrics, and a re-scan shows what is new, changed, or missing from mapped metrics. Drivers with a custom UI pick addresses through version 2 of the driver custom UI contract.
- **Release.** The agent, the driver libraries, the drivers, service-setup, Files and the Admin UI ship together in one release, so there is no feature flag and scanning is on wherever that release runs. An agent and a driver from different releases still work together, as "Compatibility rules" describes.

The old design is removed completely.

## Decisions (agreed 24 Nov 2026)

1. **Where snapshots live.** In the Files service, which gains a small `DELETE` route. Files without a delete route would leak every snapshot (a 20,000-item OPC UA scan of the test server measured 208 KB gzipped, and real servers compress less), and ConfigDB alone caps a scan at a few hundred plain items under its 100kb body limit (`deploy/values.yaml:177`).
2. **Name.** The feature stays "Edge Scout", and the UI verb is "Scan". The Gateway Depot scout (`acs-gateway-depot/lib/depot.js:84`) is unrelated and keeps its name.
3. **Cross-agent writes.** ConfigDB checks `WriteConfig` against the app, not the object (`acs-configdb/lib/api-v2.js:236-245`), so any Edge Agent can overwrite any connection's status entry. We accept that, and the UI ignores an entry whose `node` is not the node that hosts the connection.
4. **Who may scan.** Administrators only, through `ACS.PermGroup.CmdEsc`. An edge engineer grant set can follow later.
5. **First release.** Everything is in phase 1: the panel, pick, drag, diff, the panel states, bulk mapping, and version 2 of the driver custom UI contract. The contract is the set of messages between the Admin UI and a driver's own HTML UI, which runs in a sandboxed iframe in the metric pane (`docs/architecture/edge-management/driver-custom-uis.md`). Version 2 lets that UI ask the Admin UI to open its address picker (`pick-address`), read discovered items (`scout-query`) and hear when a scan changes (`scout-changed`). Phase 1 includes a version 2 test document and a jsdom test that drives it, because no driver in this repo has a version 2 UI yet.
6. **Connections with no devices.** A scan needs at least one device on the connection. The Admin UI leaves a connection with no devices out of the agent config (`acs-admin/src/utils/edgeAgentConfigUpdater.js:630-636`), so the agent never starts its driver and has nothing to ask. Changing that is a separate piece of work. The Addresses panel lives in a device's origin map editor, so there is always a device by the time an operator can press Scan, and the "Not deployed" state covers a device that has not been saved and deployed yet.
7. **OPC UA Server object.** OPC UA scans skip the Server object (`i=2253`) by default and report namespace 0 as not checked, so mapped `CurrentTime` and `ServerStatus` metrics are never flagged as missing. The option `include_server` lists it.

## Goals and non-goals

Goals:

- One generic exchange for every driver, with a library default that answers "unsupported".
- Scans never stop data collection. Depth, item, time and size caps, pacing and cancellation are enforced in the library and again in the agent, and the agent's CPU and memory use during a scan is measured against the edge-agent chart's limits.
- Results of tens of thousands of items, kept after the scan, with re-scan of the whole connection or one branch.
- Selection inside the origin map editor and inside drivers with a custom HTML UI.
- Compatibility with old agents, old drivers, and drivers outside this repo, in both directions, including an agent rollback.

Non-goals:

- Changing the origin map without the operator, who still presses Save.
- Creating metrics the device schema does not define. "Turning addresses into metrics" means filling in schema metrics, or making `patternProperties` instances (`OriginMapEditor.vue:661`), which bulk mapping does through the CSV import path.
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

1. The agent's `addr` packet carries `"features": {"scout": 1}` on every `READY`. A new library that sees it subscribes to `fpEdge1/<Conn>/scout` for the current MQTT session.
2. The agent's broker sees the subscription, and the agent sends a hello on `scout`. The library answers on `found/hello` with `supported` true or false. The agent keeps the answer in memory and writes it to the status entry only when it differs from what the entry holds, so a fleet restart writes nothing. If the driver has been `UP` for 10 s without subscribing, the agent records `"library"` in the same way. A request in the first 10 s, before the driver has subscribed, is refused `NODRIVER` with "The driver has only just started", because the driver may still subscribe.
3. The operator opens the Addresses panel in the origin map editor. The panel reads the status entry, whether the connection is in the agent's saved config, the node's online state (from the Directory until a birth or death arrives) and its NBIRTH, sets options from the DriverDef `scout.options` schema, and the operator clicks **Scan**. The panel never asks the agent for a rebirth, because a rebirth republishes every device and opening a page must not cost that.
4. The UI calls `CmdEsc.request_cmd` with the node address, name `Node Control/Scout`, type `String`, and `{"version":1,"op":"start","request":"<uuid>","connection":"<conn uuid>","root":null,"folder_id":null,"options":{...}}`. The UI sends no `limits`, so the agent's defaults apply. cmdesc checks the CmdDef permission and publishes NCMD (`acs-cmdesc/lib/cmdescd.js:93-140`). cmdesc answers 200 once the NCMD is published, whether or not the node is up (`cmdescd.js:131-139`), so the UI never treats that answer as acceptance.
5. The agent's NCMD switch (`acs-edge/lib/sparkplugNode.ts:383-394`) hands the request to the `ScoutManager`, which checks the request shape, checks the connection is deployed to this agent, clamps limits and checks concurrency. It then writes the scan fields with state `queued`, or writes only `last_request` with a refusal code and leaves the scan fields alone.
6. When the slot is free, the agent creates the snapshot File object, publishes `start` on `scout`, and writes state `running`. The scan UUID is in the status entry, as `scan` with state `queued`, before the object exists, so the service-setup sweep never deletes an object in flight.
7. The driver streams `found/<id>` messages: `items` batches, `progress` at least every 5 s, and one `end`. The agent validates each item, writes it as one NDJSON line into a gzip stream, and rewrites progress at most every 2 s, so the panel shows "Found 3,420 addresses, 41 s" and Stop.
8. On `end`, the agent uploads the gzip buffer to the Files service, writes state `done` with the new `current` and the old one as `previous`, and deletes the snapshot that dropped out.
9. The panel downloads the gzipped snapshot with its own authenticated client and hands the bytes to a Web Worker, which decompresses, parses, validates and indexes it, and the tree renders. The operator binds items to metrics, and nothing is written until Save.

### Re-scan, branch scan and cancel

- **Re-scan** runs the same steps with a new scan id. The panel keeps showing the current snapshot under a banner until the new one is ready, then shows the change bar.
- **Branch scan** sends `root` set to a folder's `root` and `folder_id` set to the folder's `id`. The agent streams the current snapshot, drops that folder and everything under it, adds the new items, and writes the result as a new snapshot. "Re-scan semantics" has the exact rules.
- **Stop** sends `{"version":1,"op":"cancel","request":...,"connection":...}`. The agent publishes `{"op":"cancel","id":...}`, the library stops within 5 s and ends with `CANCELLED`, and the previous snapshot stays current. A scan still queued is ended by the agent itself, as `cancelled` with `CANCELLED`.
- **Two operators.** A second browser attaches to the running scan through the status entry. A second Scan press is refused with `BUSY` in `last_request`, which leaves the running scan's fields untouched, so both browsers keep the live scan.

## fpEdge1 protocol additions

The normative text is the "Scouting" section of `acs-edge/docs/edge-split.md`, and `lib/edge-scout-schemas` holds a JSON Schema for every message. This section explains the design behind them. Where the two differ, `edge-split.md` and the schemas win.

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
- `excluded` lists scopes the scan did not visit on purpose, at most 8, each with an `id` of up to 256 characters and a `reason` such as `skipped`. `prefixes` optionally lists up to 4 canonical address prefixes of up to 256 characters that fall inside the scope, which lets the UI place an address it did not find. An excluded scope without `prefixes` makes every unfound address "not seen" instead of "missing".
- An `end` has either the result keys (`exhaustive`, `truncated`, `reason`, `excluded`) or an `error` with a library code, never both. `reason` is null exactly when `truncated` is false.
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
- `type` is a plain Sparkplug B type name (`Int8`, `Int16`, `Int32`, `Int64`, `UInt8` to `UInt64`, `Float`, `Double`, `Boolean`, `String`, `Text`, `DateTime`, `UUID`, `Bytes`, `File`, `DataSet` or `Template`), or null when the driver cannot say. The names carry no byte order. When the UI fills `Sparkplug_Type` it uses the name itself if the metric schema's enum has it, and otherwise the `BE` and then the `LE` form (`Int16` becomes `Int16BE`), because decoded-value drivers send JSON and byte order does not apply to them.
- `access` is `r`, `w`, `rw` or null.
- `more:true` on a folder means it has children the scan did not list. `root` is what to send for a branch scan, defaulting to `id`.
- `sample` is the value written as text, or null.
- Limits: `name` 256, `address` and `path` 1024, `description` 1024, `unit` 64, `sample` 256 characters, `detail` 2 KiB serialised. The agent truncates longer strings before it validates an item against `item.schema.json`, and drops items with no `id`, an `id` over 512 characters, a duplicate `id`, or any other schema failure, and counts every drop in `rejected`.

### Error codes

Every event has exactly one code. Each code has one component that normally sets it, and the agent also sets `OPTIONS` and `CANCELLED` for a scan that never reaches the driver.

| Code | Set by | Meaning |
|---|---|---|
| `REQUEST` | agent | The NCMD request is malformed, or `options` is over 8 KiB |
| `UNDEPLOYED` | agent | The connection is not in this agent's config, or it is not a split driver. It may not be deployed yet |
| `NODRIVER` | agent | The driver is not connected to the broker or its status is not `UP`, with the status in the message, such as `CONF` or `ADDR`. Also a driver `UP` for less than 10 s that has not subscribed yet, and a request that arrives while the agent is stopping |
| `LIBRARY` | agent | The driver has been `UP` for 10 s and never subscribed to `scout`, so its library predates scouting |
| `BUSY` | agent | A scan is already queued or running on this connection |
| `LIMIT` | agent | The per-agent concurrency limit is full and the queue is full |
| `NOTRUNNING` | agent | A cancel named a connection with no queued or running scan |
| `UNSUPPORTED` | library | The handler does not implement scouting |
| `OPTIONS` | library, from the handler | Bad `root`, `folder_id` or options. The message says which. The agent sets it, before asking the driver, when a branch scan's `folder_id` is not in the current snapshot or there is no current snapshot |
| `CONN`, `AUTH` | library, from the handler | As for driver `status`. Also `CONN` when a Rust handler's `scouter()` returns `None` |
| `CANCELLED` | library | Stopped by the operator's cancel or by a new `conf`. The agent sets it for a scan cancelled while queued |
| `ERR` | library | The handler threw or panicked, with the message |
| `TIMEOUT` | agent | The deadline passed, or no message arrived for 30 s |
| `LOST` | agent | A `seq` gap, so messages were dropped |
| `INTERRUPTED` | agent | The agent restarted, or the driver disconnected, left `UP` or sent a new hello during the scan |
| `STORE` | agent | Snapshot upload or status write failed, with the Files or ConfigDB status in the message |
| `AGENT` | agent | Any other agent-side failure, with the message. This includes a `found` message that is not JSON or fails `found.schema.json`, after which the agent sends `cancel` |

A library that receives a second `start` while one is running answers it with `ERR`, which only a faulty agent can cause, because the agent allows one scan per connection and a new `conf` cancels a running scan.

A truncated scan is not an error. It ends with `truncated:true` and a reason.

### Compatibility rules

| Agent | Driver library | Result |
|---|---|---|
| old | old | Unchanged |
| old | new | No `features` key, so the library never subscribes. Nothing changes, including after a rollback from a new agent |
| new | old | The driver never subscribes. Once it has been `UP` for 10 s, scans answer `LIBRARY` |
| new | new, driver not `UP` | Scans answer `NODRIVER` with the status |
| new | new, handler without scouting | Hello says `supported:false`. Scans answer `UNSUPPORTED` |
| new | new, scouting handler | Full exchange |

A breaking change later bumps `features.scout` to 2. Libraries scout only when they recognise the value.

edge-opcua and edge-mqtt first shipped with ACS 7.0.0 and subscribe to `write/#` at connect, which agents before 7.0.0 refuse, so they never run on those agents whatever the scouting state. The end-to-end tests therefore check them against the ACS 7 agent from before scouting, and check edge-test and edge-test-rs against the pre-v6.8.0 ACL as well.

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
     * out: { add(items) -> Promise, progress({visited, note}),
     *        pace() -> Promise, signal: AbortSignal, limits }
     * Return { exhaustive, truncated, reason, excluded },
     * or throw ScoutError(code, message). */
    async scout (req, out) { ... }
}
```

`out.add` takes one item or an array, resolves when the batch is queued, for back-pressure, and rejects with `ScoutStopped` once the scan has stopped, including at the item cap, after which the library ends the scan as truncated. `out.pace()` waits `pace_ms` and wakes early on a stop. The library also drops items deeper than `limits.depth`, working depth out from each item's parent, and ends such a scan truncated with reason `depth`. A handler that has not returned 2 s after the scan stopped is left behind and the scan ends without it. `scout` is **not** put in `messageHandlers`, because `connected()` subscribes to every key there before any addr arrives (`driver.js:319-324`) and drivers may override `setupMessageHandlers`. Instead `connected()` clears a `scout_seen` flag, and the start of `setAddrs` reads `pkt.features`, subscribes to `scout` once per session, and routes `scout` messages to a dispatcher the library owns.

**Python (`lib/py-edge-driver`).**

```python
class Handler(ABC):
    scouts: ClassVar[bool] = False
    async def scout(self, request: ScoutRequest, out: ScoutSink) -> ScoutEnd:
        raise ScoutError("UNSUPPORTED")
```

`ScoutSink` has `async add(items)`, `progress(visited, note)`, `async pace()`, `limits` and a `cancelled` `asyncio.Event`. `scout` may return a `ScoutEnd`, a dict with the same keys, or `None`, and a handler still running 2 s after a stop is cancelled. The gate sits at the top of `set_addrs` (`driver.py:257`), with the same per-session flag as JS. No Python driver lives in this repo, so the work is the library, its tests, and a CI workflow, which does not exist today.

**Rust (`lib/rs-edge-driver`).** This mirrors `TYPED_WRITES` (`src/handler.rs:118`) and the lock-free `poller()` (`src/handler.rs:265`), so a scan never holds the handler's `Arc<Mutex<H>>` (`src/driver.rs:349`) and polls and writes carry on.

```rust
pub trait Handler {
    const SCOUTS: bool = false;                               // sent in hello
    fn scouter(&self) -> Option<Arc<dyn Scouter>> { None }     // asked after each connect
}
#[async_trait]
pub trait Scouter: Send + Sync {
    async fn scout(&self, req: ScoutRequest, sink: ScoutSink)
        -> Result<ScoutEnd, ScoutError>;
}
// ScoutSink: async fn add(&self, items: Vec<Item>) -> Result<(), Stop>;
//            async fn pace(&self) -> Result<(), Stop>; fn limits(&self) -> ScoutLimits;
//            fn progress(&self, p: Progress); fn cancelled(&self) -> CancellationToken;
```

The fixed subscription list at `src/driver.rs:601-607` stays as it is. Addr handling subscribes to `scout` when it sees the feature and the per-session flag is clear, and the reconnect path clears the flag. The dispatch at `src/driver.rs:895-899` gains `"scout"`. The library asks for the scouter after each successful `connect`, as it does for `poller()`, and keeps it until the next one. `scouter()` returning `None` while `SCOUTS` is true means the handler is not connected, so the library ends the scan with `CONN`. `add` waits while the publish queue is over half full, so scan output gives way to data. `Item` has builders (`Item::folder`, `Item::value` and `with_*`), and `Stop` converts into `ScoutError` with `?`, so a scouter returns the library's stop reason unchanged. The library cannot see the device's structure, so a Rust scouter applies `limits.depth` itself. A scouter that has not stopped 3 s after a cancel or the time cap is aborted. `CancellationToken` comes from `tokio-util`, a new dependency of the crate, and is re-exported.

Every library has a test that sees the feature, then reconnects to a broker with the pre-v6.8.0 ACL that sends `addr` without `features`, and asserts that the driver is never disconnected.

## Driver implementations

### edge-opcua (built)

The scouter holds a clone of the handler's `Arc<Session>` (`edge-opcua/src/handler.rs:85`). It opens no second session, because many PLC servers have few session slots.

- **Root.** Defaults to Objects (`i=85`), which is browsed but not listed, so its children have `parent` null. When `root` is set, the root node is sent as the first item with `parent` null. A root that is not a NodeId, does not exist, or is not an Object or a Variable ends the scan with `OPTIONS`. A branch scan's `folder_id` must equal the canonical form of `root`. The scan root travels as the request's `root`, never as an option. The Server object (`i=2253`) is skipped unless the root is inside it or the option `include_server` is true. When it is skipped, the `end` message reports it in `excluded` with `prefixes: ["i="]`, because almost every namespace 0 node under Objects sits inside the Server object.
- **Options.** Only `include_server`, `expand_arrays` and `units`, all booleans. Unknown keys are logged and ignored, as protocol readers ignore unknown keys.
- **Ids.** An item's `id` is its canonical NodeId string. Element items from `expand_arrays` use `<nodeid>[i]`.
- **Walk.** Breadth-first Browse over `HierarchicalReferences` (`i=33`), subtypes included, forward only, node class mask Object and Variable, `requestedMaxReferencesPerNode` 1000. Variables are browsed as well as Objects, because their `HasProperty` and `HasComponent` children (EURange, EngineeringUnits) are hierarchical. BrowseNext follows every continuation point, and all outstanding points are released with `releaseContinuationPoints=true` on cancel, timeout, cap or error. A BrowseNext that fails for a node gives that item `more:true` and makes the end `exhaustive:false`. On cancel, a request in flight may take up to 1.5 s more and the release is capped at 1 s, which keeps the scouter inside the library's 3 s stop grace.
- **Visited set.** Keyed by the canonical NodeId string. A node reached by a second path is listed once, under the first parent, which also ends `Organizes` cycles. A branch scan can therefore list a node already listed elsewhere, and the agent's merge rule removes that duplicate.
- **Batching and pacing.** Nodes per Browse are min(`MaxNodesPerBrowse`, 50) and per Read min(`MaxNodesPerRead`, 100), read once from the server's OperationLimits and defaulting to those numbers when absent or 0. One request is in flight at a time, with `pace_ms` between requests. On `BadTooManyOperations` the batch halves and the pace doubles, from at least 20 ms up to 2 s, and never comes back down within a scan. A server that refuses a batch of one gives `ERR`.
- **Attributes.** For each Variable: DataType, ValueRank, ArrayDimensions, UserAccessLevel and Description. Value only with `samples`, and EngineeringUnits only with the option `units`, which needs the variable's own browse, so a variable at the depth cap gets no unit.
- **Types.** Boolean, SByte to Int8, Byte to UInt8, Int16 to UInt64, Float, Double, String, DateTime and Guid to UUID. Enumerations map to Int32 and LocalizedText to String. A subtype of one of these gets its supertype's type, found by walking `HasSubtype` with a cache. Structures, ByteString and the rest get `type:null` with `detail.ua_type`. Arrays get `type:null`, `detail.dims` (0 for an undeclared length) and `detail.ua_type`. There is no `detail.node_class`, because `kind` already says it. With the option `expand_arrays` (default off) arrays of up to 64 elements get element items addressed `node[i]` or `node[i,j]`, which `edge-opcua/src/addr.rs` parses, with the array node as their parent. An element id that is already a real node, as a PLC's `T/Elem[3]` often is, is listed once, as that node.
- **Address.** The canonical form `addr.rs` prints, so namespace 0 is written `i=2258`, never `ns=0;i=2258`. The UI's `opcua` normaliser turns a metric's address into the same form before it compares (see "Re-scan and diff semantics"). `detail.namespace_uri` records the namespace URI, because an `ns=` index can change when a server is rebuilt.
- **Caps.** Each request uses `REQUEST_TIMEOUT` of 10 s (`handler.rs:66`). A node at the depth cap gets a peek Browse (one reference, points released at once) and `more:true` if it has children, so a cap node whose only child is listed elsewhere still shows `more:true`. `BadUserAccessDenied` on a branch gives a folder with `detail.denied`, `more:true` and reason `partial_access`.
- **Failures.** Not connected or session lost gives `CONN`, with no automatic retry. A bad root or a bad option type gives `OPTIONS`.
- **Measured.** The test server's 20,445-node tree (20,000 variables with descriptions in 445 folders) takes 1,420 requests and 3.1 to 3.4 s with no pace, and about 28 s more at the default 20 ms pace (worked out from the request count). The snapshot is 6.8 MB raw (334 bytes an item) and 208 KB gzipped. `T/Counter` kept 9.3 to 9.8 messages a second during a full scan with no pace, against 9.7 before.
- **Tests.** 25 unit tests in `src/scout/tests.rs` against a fake `Service` trait (browse, browse_next, read), which stands in for the mocked session, and 10 integration tests in `tests/scout.rs` against `tests/server/scout.cjs`, the `SCOUT` mode of the node-opcua server.

### edge-mqtt (built)

The old scout reused the main client id, so the broker dropped the data session. The scouter opens a **second, short-lived client** with the same host, TLS and credentials (`edge-mqtt/src/handler.rs:86-106`), clean session, no will, QoS 0. Its client id is `<clientId>-scout-<6 hex>`, or `fpscout-<12 hex>` when that would pass 23 characters, unless the option `client_id` sets it.

- **Options.** `filters` (default `["#"]`, at most 32, each checked with `topics::valid_filter`), `seconds` (default 10, 1 to 120), `inspect_bytes` (default 64 KiB, at most 1 MiB), `json_leaves` (default true) and `client_id`, which may not equal the driver's own. A value out of range is refused with `OPTIONS`, not clamped, and unknown keys are ignored. A `root` replaces `filters`, and a `folder_id` must end in `/` and needs a `root`. Topics starting with `$` are skipped unless a filter starting with `$` matches them.
- **Ids.** A folder for topic level `a/b` has id `a/b/`. A topic has id `a/b`. A JSON leaf has id `a/b`, a NUL character, then its JSONPath. A topic `a/b` that carries messages and also has child topics `a/b/c` therefore gets both a folder `a/b/` and a value `a/b`, and its children hang off the folder. A topic whose name ends in `/`, such as `a/`, has the same id as the folder for level `a`, so the two become one item: a value with address `a/` and root `a/#` that has children. A branch scan lists only topics that start with `folder_id`, so `a/b/#` leaves out the topic `a/b`, which belongs to the parent folder.
- **Items.** Each topic is a value with `address` set to the topic and `path` null. A folder's `root` is `a/b/#`, so a branch scan listens on that filter. `detail` holds `{count, rate_hz, retained, format}`.
- **JSON.** For payloads up to `inspect_bytes`, each leaf becomes a child of the topic's value item, with the same `address`, `path` as JSONPath (`$.a.b[0]` for plain keys, `$['key']` otherwise), and an inferred type: Int64 when every sample was an integer, else Double, then Boolean and String. Depth 8 and 200 leaves per topic, and a topic with leaves left out gets `more:true`. A key containing a quote, bracket, parenthesis, a jsonpath-plus special character, a comma, semicolon, backslash, backtick or control character, or an empty key, gets no leaf, because the agent's jsonpath-plus could misread it. The same type rule applies to a topic whose payloads are JSON scalars, and plain text counts as String. Mixed kinds, objects, arrays, XML and binary get `type:null`, and `access` is always null.
- **Load.** Each topic's first 16 messages are inspected, and later ones only counted. Retained messages arrive in one burst after SUBACK and are analysed in full, bounded by `inspect_bytes`, the item cap and a total of 32 MiB inspected per scan. The flood cutoff counts only live messages, in 1 s buckets. Above 5,000 live messages a second the scouter keeps recording topics and stops payload analysis for the rest of the window. `detail.format` is left out when no payload of a topic was inspected, and is `mixed` when the inspected payloads differed.
- **Ending.** Listening starts at the SUBACK and lasts `seconds`, less min(5 s, a quarter of `limits.seconds`) kept back from the agent's time cap for sending, which is not reported as truncation. It ends early at the item cap (truncated). When the broker's SUBACK reports failure on some filters the scan ends with reason `partial_access`, and on every filter with `AUTH`, "The broker refused every filter. Give narrower filters." When several caps apply, the reason is `items`, then `partial_access`, then `depth`. A refused connection gives `AUTH` for bad credentials, not authorised or a bad client id, and `CONN` otherwise. A lost connection or no SUBACK within 10 s gives `CONN`, and what the scan heard is dropped. Items go to the library in chunks of 1,000, each parent before its children.
- **Broker ACLs (spike result).** On mosquitto 2.0.21 and 2.1.4, an `acl_file` grants every SUBSCRIBE (SUBACK 0, even for `#` or a denied filter) and silently filters delivery, so `AUTH` and `partial_access` never happen and denied topics are absent. The dynamic security plugin checks the filter and answers SUBACK 128 for a filter the client may not subscribe to, so there `partial_access` and `AUTH` do happen. The `edge-mqtt` README says so.
- **Exhaustive** is always false.

### Every other driver

| Driver | Library | Now |
|---|---|---|
| edge-test | JS | Built. Deterministic tree set by options (`size`, `depth`, `fail`, `hang`, `delay_ms`, `duplicates`, and `after`, the number of items listed before `fail` or `hang` takes effect). Folders split into up to 4 sub-folders, each value's id is its canonical address. `SCOUT_UNSUPPORTED=1` selects a handler with `scouts` false, for the end-to-end `UNSUPPORTED` case. Conformance fixture |
| edge-test-rs | Rust | Built, with the same option names but its own tree: folders of up to 10, values `v<n>` with addresses `<func>:1000:<n>:<packing>`, `PANIC` as a `fail` value, and no `after`. The two trees differ, so their scans are not interchangeable. size 45,000 at depth 2 gives exactly 49,950 items, which the load test uses |
| edge-sim | JS | Built. Lists the loaded cassette's channels, with `/` making folders as for MQTT, and a `player:` folder with the 12 `player:*` addresses. An empty, exhaustive scan with no cassette loaded, and `OPTIONS` for a branch scan then. It takes no options. The JS reference scouter |
| edge-ads, edge-bacnet, edge-focas, edge-ftp, edge-pathfindr, edge-rtde, edge-tplink-smartplug | JS, FOCAS Rust | `UNSUPPORTED` now, from the library's default. Later: ADS symbol upload (next), BACnet `object-list`, FTP directory walking through its `list:<dir>` addresses (`dumps/edge-ftp.yaml`), FOCAS and fixed catalogues, Pathfindr's asset API |
| edge-modbus, edge-rest, edge-udp, edge-openprotocol | JS, REST and UDP Rust | `UNSUPPORTED` by design. The protocol has nothing to list |
| Drivers outside this repo | any | `LIBRARY` until rebuilt on a new library, then whatever they implement |

Every JS driver in the repo (edge-ads, edge-bacnet, edge-ftp, edge-modbus, edge-openprotocol, edge-pathfindr, edge-rtde, edge-sim, edge-test and edge-tplink-smartplug) depends on `file:../lib/js-edge-driver`, installs it with `--install-links` and builds with the `lib` build context, as the Rust drivers do with `lib/rs-edge-driver`. `publish.yml` already passes `lib=./lib` to every driver build, so each image carries the library of the same ACS release and no driver in the repo answers `LIBRARY`. The JS drivers previously pinned the published npm package (0.0.5, 0.1.0 or 0.1.1), none of which has scouting. Pinning a new npm version instead would need a separate `js/edge-driver/vX` release published before the ACS release builds, which the release workflow does not order. `lib/js-edge-driver` is now version 0.2.0, above every published version, so the hello's `library` reads `js-edge-driver 0.2.0`. Its next npm release, for drivers outside the repo, should be 0.2.0 or later.

## Edge Agent changes

- **`lib/devices/driver.ts`**
  - Add `features: {scout: 1}` to the `addr` packet (`:429-436`).
  - Exempt `found` from the data flush at `:342`. Every non-data message flushes today, so without this every items batch would split DDATA groups during a scan.
  - Add `scout` to the looped-message cases (`:350-357`), so the agent does not log "Unexpected scout message" for its own publishes.
  - Route `found` to the `ScoutManager` as a `found` event. Track `up_since`, and emit `status` before sending a new `conf`, so a running scan's `cancel` reaches the driver first.
- **`lib/driverBroker.ts`**: the ACL additions, the scout subscriber map with `scouts(id)`, and the test-only `acl` option.
- **`lib/sparkplugNode.ts`**: an NBIRTH metric `Node Control/Scout` (String, `""`) beside the others (`:168-182`), and an NCMD case beside `:386` that parses the JSON and emits `scout`. Bad JSON, or JSON that is not an object, is logged and ignored. The 28 golden NBIRTH recordings in `tests/golden/recorded` gained the metric by hand, as the golden README prescribes for a deliberate output change.
- **`lib/translator.ts`**: delete the old branch at `:410-415`, construct the `ScoutManager` once the agent knows its UUID, and wire `sparkplugNode.on("scout")`. A failure to construct it is logged and the devices still run. `translator.connections` is keyed by connection type (`:396`), so it holds only the last `Driver` connection, and `DriverConnection` stores no connection UUID (`driver.ts:86-97`). `setupConnection` therefore registers each split-driver connection that has a `uuid` with `add_connection(uuid, conn, {config_hash})`, where `config_hash` is taken from the config as stored, before secrets are filled in. The Translator awaits `scout.init()` after setup, and `Translator.stop` awaits `ScoutManager.stop()` first, while the broker can still reach the drivers, so it cancels running scans and finishes their status writes before an in-process reload starts the new `init()`.
- **New `lib/scout.ts`, `ScoutManager`.** Constructor takes `{ fplus, broker, node, env?, timing?, schemas? }`, where `node` is the agent's UUID, because the manager needs nothing else from the Translator. `timing` lets tests shorten the silence, deadline, library-wait, throttle and stop timers. House style with snake_case methods. It:
  - keeps its own map from connection UUID to `DriverConnection`
  - keeps a state machine per connection: idle, queued, running, saving
  - allows `SCOUT_MAX_CONCURRENT` (default 1) scans per agent, one per connection, with a queue of 4
  - runs a 30 s silence timer and a deadline of `seconds + 15` s, which both send `cancel` and end the scan with `TIMEOUT`
  - validates every NCMD, message and item against the JSON Schemas in `lib/edge-scout-schemas` with ajv validators compiled once at start-up in `lib/scout-schemas.ts` (the schemas are draft 2020-12, so the agent uses `ajv/dist/2020.js` with ajv-formats, and `ajv` is now a direct dependency). The agent reads the schema files from the installed package and does not load the package's `lib/index.js`, which ts-jest's CommonJS build cannot load. `SCOUT_SCHEMA_DIR` overrides the path. It detects `seq` gaps, and drops duplicate ids
  - cleans each item on its own: keys the item schema does not name are stripped, long strings are cut, and the item is then validated. An item whose `detail` is over 2 KiB keeps its other fields with `detail` null, so its address survives. An `items` message over 256 KiB is dropped. A `found` message that is not JSON or fails its schema ends the scan with `AGENT` and a `cancel`
  - enforces the item cap itself as well as the driver: at the cap it sends `cancel`, and the scan is saved as `done`, truncated, reason `items`, whatever end the driver sends after the cancel, or none at all. The size caps work the same way with reason `size`
  - streams items as NDJSON lines through `zlib.createGzip()` into an in-memory buffer, and stops at `SCOUT_MAX_BYTES` (default 32 MiB uncompressed) or `SCOUT_MAX_GZ_BYTES` (default 8 MiB compressed), reason `size`
  - yields to the event loop between batches, so DDATA handling is never queued behind a batch
  - creates the File object and uploads the finished Buffer with `fplus.Fetch`, as `fileRequest` does (`translator.ts:211-268`). It never uploads a stream, because `fplus.Fetch` retries once on 401 by sending the request again (`lib/js-service-client/lib/service/fetch.js:349-353`) and a stream would already be used up. Files 403, 404 and 409 become `STORE` messages that name the cause
  - for a branch scan, streams the current snapshot twice (`index_snapshot` then `merged_items` in `lib/scout-snapshot.ts`): once to build the map of ids to parents, then again to copy every line outside the replaced subtree, so it never holds the parsed snapshot. A `folder_id` missing from the current snapshot ends the scan with `OPTIONS` before the driver is asked
  - keeps `current` and `previous`, and deletes the snapshot that drops out
  - writes status entries one at a time in order, only when the entry changed (ignoring `updated`), with progress throttled to one write every 2 s, and the hello result only when it changes. Each entry is validated against `status.schema.json` and trimmed under 16 KiB. The agent never writes over an entry it could not read, and never records a refusal over an entry another node owns
  - on `init()`, reads the status entries for its connections, rewrites `queued` or `running` as `failed` with `INTERRUPTED`, and deletes the in-flight snapshot object. A driver disconnect, a status other than `UP`, or a new hello during a running scan does the same
- **Environment.** `SCOUT_MAX_CONCURRENT`, `SCOUT_MAX_BYTES` and `SCOUT_MAX_GZ_BYTES`, with defaults of 1, 32 MiB and 8 MiB, and `SCOUT_SCHEMA_DIR` for tests. The edge-agent chart does not set them yet, so agents use the defaults. There is no switch to turn scanning off, because everything ships in one release.
- **Packaging.** `package.json` depends on `file:../lib/edge-scout-schemas`. The Dockerfile now copies the `lib` build context to `/home/node/lib` with `WORKDIR /home/node/app` and runs `npm install --install-links`, as acs-configdb does, so the `file:` dependencies are copied into `node_modules`. Before this, `file:../lib/js-service-client` resolved to `/usr/lib` inside the image.
- **Memory and CPU.** The edge-agent chart limits the agent to 100m CPU and 200Mi (`edge-helm-charts/charts/edge-agent/values.yaml:65-67`). A scan holds at most the gzip buffer (8 MiB) and, during a branch merge, the id map (a few MB for 50,000 items). Measured in the end-to-end load case, peak memory stays at 120 to 131 MiB, well inside the limit, but DDATA latency rises during a large scan under the CPU limit. The numbers are in "Risks" item 2 and in the "Scouting" section of `edge-split.md`.
- **Logging.** Every state change and failure goes to stderr at the default level, not only to DEBUG.

## Result storage, size limits and retention

**Why Files.** ConfigDB caps bodies at 100kb (`deploy/values.yaml:177`, `lib/js-service-api/lib/webapi.js:28`), which holds a few hundred plain items. Files allows 3gb (`deploy/values.yaml:218`), needs an existing object of class File before upload, and refuses to overwrite (`acs-files/lib/api-v1.js:155-161`), which suits immutable snapshots.

**Status entry.** App `Edge.App.ScoutStatus`, keyed by the connection UUID, written only by the agent. `lib/edge-scout-schemas/schemas/status.schema.json` is its ConfigSchema, and it allows no keys beyond those below. It bounds every string with `maxLength` and every list with `maxItems`, which keeps the worst case at about 50 KB of ASCII, under ConfigDB's 100kb body limit. A typical entry is under 2 KB. The agent also refuses to write an entry over 16 KiB serialised: it drops the oldest `branches` entries first, then the `prefixes` of `excluded` scopes, and logs that it did.

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

- `version`, `node` and `supported` are required. Every other key may be absent or null until the first scan sets it, and `current` and `previous` are null until there is a snapshot to point at.
- `supported` is `true`, `false`, `"library"` or null when not yet known.
- `state` is one of `queued`, `running`, `done`, `failed` or `cancelled`. The agent's internal `saving` step shows as `running`. `code` is any code from "Error codes", and `last_request.code` is null or one of the refusal codes `REQUEST`, `UNDEPLOYED`, `NODRIVER`, `LIBRARY`, `BUSY`, `LIMIT` and `NOTRUNNING`.
- Times are RFC 3339 strings in UTC, and `options_hash` and `config_hash` are `sha256:` followed by 64 lowercase hex digits.
- The scan fields (`scan` to `progress`) describe the latest accepted scan only. A refusal never touches them. It goes in `last_request`, which the UI matches against its own request UUID. An accepted request also sets `last_request` with `code` null.
- `options` is kept only in the snapshot, and the entry holds its hash.
- `branches` keeps the last 10 branch scans. `excluded` keeps at most 8 scopes, each with an `id` and prefixes of at most 256 characters and at most 4 prefixes.
- `message`, `last_request.message` and `progress.note` are at most 512 characters, `root` and `folder_id` at most 1024.
- `config_hash` hashes the connection's driver details without secrets, so the UI can say a snapshot predates a settings change.

**Snapshot.** gzip of NDJSON. The first line is a header `{"version":1, "scan", "connection", "driver", "started", "root", "folder_id", "options"}`, each following line is one ITEM, and the last line is `{"end":{"finished", "exhaustive", "truncated", "reason", "excluded", "rejected", "items", "branches"}}`. `driver` is the `library` string from the driver's hello, or null. `root` and `options` describe the snapshot as a whole, so a snapshot merged from a branch scan carries the base snapshot's, and `folder_id` is the branch scan's folder id, or null for a full scan. `items` counts the item lines and `rejected` the items the agent dropped, which for a merged snapshot is the base's count plus the branch scan's. A reader treats a snapshot with no `end` line, a first line that is not a header, or an `items` count that does not match as invalid. `lib/edge-scout-schemas` has a schema for each line and a `check_snapshot` function for the whole file. Measured with the `server.cjs` SCOUT mode, a 20,445-item OPC UA scan is 6.8 MB raw (334 bytes an item, because NodeIds repeat in `id`, `parent` and `address`) and 208 KB gzipped, 3.0% of raw. The design estimate was 6 to 12 MB raw and 0.6 to 1.2 MB gzipped. The test server's names are very regular, so real servers compress less, and the 32 MiB raw and 8 MiB gzipped defaults leave plenty of room. A 49,950-item edge-test-rs scan was 865 KB gzipped.

**Retention.** Each connection keeps `current` and `previous`, and only those two count as references. A failed or cancelled scan leaves both alone and deletes its own File object. To delete a snapshot, the agent first calls the new Files `DELETE /v1/file/:uuid`, which needs the object to exist for its class-based permission check, and then deletes the ConfigDB object. `DELETE` succeeds when there is no content, because the object is created before upload and a failed scan never uploads. Deleting a connection removes its status entry, because ConfigDB deletes an object's configs with it (`acs-configdb/lib/model.js:573-615`). A service-setup fixup sweeps orphaned `Edge.Class.ScoutResult` objects on every upgrade, so they go away without a hand-run script. ConfigDB keeps no creation time for an object, so "more than a day old" is worked out from what is recorded. The sweep keeps an object when a status entry names it as `current.file` or `previous.file`, when a status entry names it as `scan` and is `queued` or `running` or was updated less than a day ago, or when its Files upload record is less than a day old. Everything else is swept: Files `DELETE` first, and the ConfigDB object only after a 204. A Files 403, 404 or error keeps the object for the next run, and the sweep deletes nothing when it cannot read the status entries (a 404 meaning no app is the exception). This is safe because the agent writes the scan UUID into the status entry before it creates the object. The agent treats a 403 or 404 when it deletes a snapshot as already gone, because the sweep may have removed it first.

## Triggering and permissions

These UUIDs were made with `uuidgen` for this design and are fixed. The old design's ConfigDB app UUID is not reused. Each goes in `acs-service-setup/lib/uuids.js` under its constant name. `Edge.App.ScoutStatus`, `Edge.Class.ScoutResult` and `Edge.Perm.Scout` also go in `lib/js-service-client/lib/uuids.js` and `acs-edge/lib/uuids.ts`, and `Files.Perm.Delete` also goes in `acs-files/lib/constants.js` beside `Perm.Download`.

| Constant | UUID | What |
|---|---|---|
| `Edge.App.ScoutStatus` | `ad73fae4-a3b9-457a-8c36-12a2019bff2c` | App "Edge scout status", `subclassOf MetaDB.Class.ConfigEntry` |
| `Edge.Class.ScoutResult` | `10916e96-f6fe-44cc-8c01-16a775426038` | "Edge scout result", an R1 class with `subclassOf Files.Class.File` and `memberOf Files.Class.FileGroup`, copying `Edge.Class.DeliveryFile` (`acs-service-setup/dumps/edge-ftp.yaml:27-33`) |
| `Edge.Perm.Scout` | `41443382-ecad-439b-999f-cb611bc11f7c` | "Scan device addresses", member of `ACS.PermGroup.CmdEsc` |
| `Files.Perm.Delete` | `82a2206b-b9d8-4eee-bc0e-63fb8785019e` | "Delete", a new Files permission, member of `Files.Perm.All` |

Dump changes:

- **`dumps/files.yaml`**: `Files.Perm.Delete` under `Files.Perm.All`, beside `Upload` and `Download` (`:27-30`).
- **`dumps/edge.yaml`**: the app, class and perm, the ConfigSchema for the status app (a copy of `status.schema.json`, written as JSON inside the YAML so re-copying it is a paste, and checked by a sync test), the CmdDef, and a `scout` key on the DriverDefs for OPC-UA, MQTT, Test and Test (Rust, sharing Test's key through a YAML anchor), documented in the comment block at `:72-101`. The Simulator DriverDef lives in **`dumps/edge-sim.yaml`** (`:36`) and gets its key there, with no options. Every key sets `share_samples: false`, and no DriverDef sets `scout: false`, so drivers that cannot scan keep the panel and the hello decides. Its `#-REQUIRE` line is now `auth sparkplug acs-v2 files`, because the class subclasses `Files.Class.File` and the CmdDef app comes from acs-v2.

  ```yaml
  scout:
    title: "Scan the server's address space"
    address_form: opcua          # UI normaliser: opcua, mqtt or exact (default)
    options: { type: object, properties: { root: { type: string } } }
    share_samples: false         # let a custom UI see item samples
  ```

  A missing `scout` key means "show the panel and trust the hello", which covers `ACS.Driver.External` and drivers outside this repo. `scout: false` hides the panel. Exhaustiveness is reported by each scan and is not part of the DriverDef.

  As built, the OPC-UA key lists `root`, `include_server`, `units` and `expand_arrays`, MQTT lists `filters`, `seconds`, `inspect_bytes`, `json_leaves` and `client_id`, and Test lists `size`, `depth`, `fail`, `hang`, `delay_ms` and `duplicates`. The UI sends options as they are, and edge-opcua reads the scan root from the request's `root`, not from options, so the OPC-UA `root` option has no effect (see "Known gaps").

- **The CmdDef** `CmdEsc.App.CmdDef` entry `Edge.Perm.Scout: [{name: "Node Control/Scout", type: String}]` sits in `dumps/edge.yaml`, not `dumps/acs-v2.yaml` as first planned. ConfigDB returns 404 for a config on an object that does not exist yet, and edge.yaml creates `Edge.Perm.Scout` while acs-v2 loads before it, so a CmdDef in acs-v2.yaml would fail on a fresh install. This follows `edge-sim.yaml` and `edge-ftp.yaml`, where each dump creates its CmdEsc perm and its CmdDef together.
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

- **`acs-files`**: a `DELETE /:uuid` route in `setup_routes` (`acs-files/lib/api-v1.js:27-33`), served as `DELETE /v1/file/:uuid` because the router is mounted at `/v1/file` (`acs-files/lib/routes.js:7`). It answers 400 for an invalid UUID before any check, checks `Files.Perm.Delete` against the file UUID with wildcards, so class grants apply, removes any stored content, then removes the file's `Files.App.Config` upload record, and answers 204 whether or not content existed. A ConfigDB failure on the record answers 503, and a retry finishes the job. It leaves `<uuid>.temp` uploads alone. acs-files uses express 4 for its router, so the handler passes its own errors to `next()`. The existing handlers are unchanged.

Administrators already hold `ACS.PermGroup.CmdEsc`, ConfigDB and `Files.Perm.All` (`acs-service-setup/dumps/admin.yaml:100-104`), so they can scan and read results with no new grant. The UI checks the Scout permission the way `useCanRebirth.js` does and disables Scan with the reason.

**Fixups** in the new `acs-service-setup/lib/edge-scout.js` (`EdgeScoutFixup`), called from `fixups()` in `lib/fixups.js` before the dumps load, as the other fixups are:

- Strip `scout` from every connection in `Edge.App.AgentConfig`. `applyConnection` updates entries in place and keeps unknown keys (`edgeAgentConfigUpdater.js:63-79`), so the dead key would otherwise stay forever. It rewrites with `If-Match` and retries on 412, and writes nothing when there is nothing to strip.
- Sweep orphaned `Edge.Class.ScoutResult` objects by the rule under "Retention", calling Files `DELETE` before deleting each ConfigDB object. lib/js-service-client has no Files delete method, so it calls `fplus.Fetch` directly.

Nothing in the fixup can stop service-setup. Failures are logged as errors, and on a site without the class or the app it does nothing.

## Admin UI design

### Layout

`OriginMapEditor.vue` has the schema tree sidebar and the metric pane (`SidebarInset`, `:101-145`). Add a third, right-hand panel, **Addresses**, opened from a header button beside the `actions` slot (`:123`) that shows the item count. It is resizable and collapsible, with its width remembered in localStorage, and becomes a sheet over the metric pane below `lg` widths. The operator reads left to right: schema, metric, discovered address. The panel is hidden when the DriverDef has `scout: false`.

### Components

Under `OriginMapEditor/Scout/`:

- `ScoutPanel.vue`: state view and header ("9,812 addresses, scanned 24 Nov 10:42") with Scan or Re-scan, Stop, and an options form from `driverDef.scout.options`.
- `ScoutTree.vue`: a virtualised tree with fixed 28 px rows. Columns are name, address in monospace, type, access, sample, a mapped-to chip and a change badge (New, Changed or Renamed). The virtualisation is about 20 lines of its own arithmetic rather than `@tanstack/vue-virtual`, because a new dependency would have meant updating both `package-lock.json` and the `bun.lock` the Docker build uses with `--frozen-lockfile`, and fixed rows make the arithmetic small.
- `ScoutChangeBar.vue`: counts and filters for New, Changed, Gone or Not seen this time, Mapped but missing, and Mapped, not seen. Gone, not-seen and missing entries are not tree rows, so the bar lists them, and a missing metric can be clicked to select it.
- `ScoutMapDialog.vue`: bulk mapping.
- `ScoutPicker.vue`: the picker dialog that a driver custom UI opens with `pick-address`.
- `src/composables/useScout.js`: `create_scout`, with state, `start`, `scan_branch`, `cancel` and snapshot loading, over `CmdEsc.request_cmd`, `ConfigDB.watch_config` (`lib/js-rx-client/lib/configdb.js:36`) for the status entry and the agent's config, the Directory (`v1/device/<node>`) for the first online state, the node's births and deaths through `SparkplugApp.watch_address`, and the `Edge.Perm.Scout` permission from the expanded ACL, as `useCanRebirth` does. It follows births, the online state and the ACL only while the panel is open, because the Sparkplug watch opens an MQTT connection. It never forces a rebirth.
- `src/lib/scout/model.js`: pure functions with no Vue or DOM, like `contract.js`, for search, diff, comparable, address normalisers, usage, mapped-but-missing, auto-match, bulk rows, `panel_state` and the code texts.
- `src/lib/scout/snapshot.js`: decode, validate and index a snapshot. It imports nothing, because its raw source plus a message handler is the worker, run from a blob URL (`src/lib/scout/load.js`). A Vite-bundled worker pushed the production build past Node's default 4 GB heap, and the CSP already allows `worker-src blob:`. The page fetches the gzipped bytes with its own authenticated client and transfers them, so no credentials reach the worker.
- `src/lib/scout/text.js`: what the panel says in each state, kept apart so the wording is tested with the states.
- `src/lib/scout/ensure-metric.js`: `ensure_metric`, below.
- `src/lib/scout/constants.js`: the scout UUIDs as local constants, because `@amrc-factoryplus/service-client` does not export them yet, and the timings.
- `src/lib/driver-ui/host.js`: the Manager's side of the driver custom UI exchange, pulled out of `DriverCustomUI.vue` so a jsdom test can drive it.

`acs-admin/preview` has a scout surface (`#/?surface=scout&state=...`) and a `driver-ui` surface for checking the panel and a version 2 driver UI without a cluster.

### States

The panel works out its state in this order, and the first match wins.

| State | When | What the operator sees |
|---|---|---|
| Hidden | DriverDef `scout: false` | No panel |
| Agent offline | No NBIRTH since the last NDEATH | "The Edge Agent is offline, so it can't scan." Any previous snapshot stays browsable |
| Agent too old | Online, and an NBIRTH seen since the page loaded has no `Node Control/Scout` | "This Edge Agent can't scan. Upgrade it to the current ACS release." Without a forced rebirth, an old agent that has not reborn since the page loaded shows as Waiting after a Scan instead |
| Untrusted | The status entry's `node` is not this connection's node | "The scan status for this connection was written by an Edge Agent that does not host it, so the panel ignores it." |
| Not deployed | `UNDEPLOYED` in `last_request`, or the connection is not in the agent's saved config | "Save and deploy this connection before scanning it." |
| Unsupported | `supported:false` | "The Modbus driver can't list its addresses. Type them in the metric panel." |
| Driver too old | `supported:"library"` | "This driver was built before scouting. Update the driver image." |
| Driver not running | `NODRIVER` in `last_request` | "The driver isn't ready" with the status it reported, such as a config or address error. Offers Try again, because the code stays until another request replaces it |
| No permission | No `Edge.Perm.Scout` | Scan disabled: "Needs the Scan device addresses permission." Existing snapshots stay browsable |
| Never scanned | No `current`, no scan fields and no request pending | What a scan does, that data collection carries on, the options, and Scan |
| Sending | This browser sent a request less than 15 s ago that the entry does not show yet | "Sending the request to the Edge Agent." |
| Waiting | A request was sent, and neither `request` nor `last_request.request` matches it after 15 s while the node is online | "The Edge Agent didn't record the request. Its log says why, and a missing grant is the usual cause." |
| Refused | `last_request` matches this browser's request with a code | The plain-words reason for `BUSY`, `LIMIT`, `REQUEST` or `NOTRUNNING`. `BUSY` offers to follow the running scan |
| Queued, Running | `state` is `queued` or `running` | Live count, elapsed time and Stop. The previous snapshot stays browsable under a banner |
| Done, empty | `done` with 0 items | "The scan found no addresses." For MQTT: "Nothing was published in the 10 s window." For a simulator: "Load a cassette first." |
| Done | `done` | The tree. A truncated banner names the cap and suggests a branch scan. A stale banner shows when `config_hash` differs. The UI cannot compute the agent's hash, so it compares the entry's `config_hash` (the latest scan's) with `current.config_hash`, and the banner only shows when the latest accepted scan ran under different settings from the current snapshot |
| Failed, Cancelled, Interrupted | `failed` or `cancelled` | The plain-words message for the code, any previous snapshot, and Try again |

### Browsing and binding

- Search covers name, address, path, description and unit, with a 150 ms debounce. Matches show their ancestor path and a count.
- Filters: Values only, Not mapped (across every device on this connection), New since last scan, Writable, and Type.
- Every drag has a keyboard equivalent, and Enter uses the item for the selected metric.
- **Pick from scan** sits next to the Address input (`SparkplugMetric.vue:48`). Clicking an item, pressing Enter, or dragging a row onto a metric in the schema tree fills `Address` and `Path`, `Sparkplug_Type` when unset and allowed, and `Eng_Unit` and `Documentation` only when empty.
- **Editing path.** A drop target may be a schema metric with no origin map entry yet. An `ensure_metric(chain)` helper, pulled out of `selectMetric` (`OriginMapEditor.vue:741-822`), creates the entry with its defaults and stamps `Schema_UUID` and `Instance_UUID` up the chain. It also fixes a bug in the old code, which restamped an existing nested group's `Schema_UUID` and minted a new `Instance_UUID` when a new metric was created inside it. `ensure_metric` checks each level and keeps existing Instance_UUIDs. Values then go through `validate_proposal` and `apply_proposal` (`acs-admin/src/lib/driver-ui/contract.js:262`, `:315`) **in place** on that object, because the editor identifies metrics by object identity and that file records that replacing the object loses the edit. The helper then calls `markDirty` and bumps `rerenderTrigger` and `groupRerenderTrigger`, because a metric that is not selected has no `SparkplugMetric` instance to emit `input`. Nothing saves on its own.
- **Reverse view.** Selecting a metric reveals its address in the tree. When the metric meets the "Mapped but missing" rule, the metric pane shows "Not found in the scan of 24 Nov".
- **Folder rows** offer "Scan this branch".
- **Bulk mapping.** Select items, then Map selected. The dialog proposes a metric per item by normalised name (lowercase, letters and digits only), tie-broken by parent name and then type, and two items claiming one metric both become ambiguous. Each row is matched, ambiguous ("More than one"), type conflict ("Type differs"), or no metric. For a `patternProperties` collection it offers "Create n objects named after the addresses". Apply reuses the CSV import path (`applyCsvToModel` and `updateDynamicSchemaObjects`, `OriginMapEditor.vue:1095-1140`), through a new `applyRows` method shared with the CSV import, which already handles bulk creation, dirtiness and re-rendering. Like the CSV import, it replaces the model and clears the selected metric. Objects are created through `applyCsvToModel`'s `patternProperties` branch, which stamps the UUIDs as `createObject` does, rather than through `createObject` itself, which depends on the new-object dialog. Object names never contain `/` or `.`, because the CSV path splits tag paths on `/` and the editor's setter splits model paths on `.`, so such a name falls back to a sanitised form (`Motor.1` becomes `Motor_1`), and `object_name_problem` refuses empty, duplicate, path-breaking or pattern-breaking names.

Items come from the device, so the UI treats every string as untrusted text and never renders it as HTML.

### Driver custom UIs: contract version 2

When a DriverDef has a `ui` document, `SparkplugMetric.vue` renders `DriverCustomUI` in place of the standard fields (`v-if="showCustomUI"`, `:11`), so the Pick button is not there. Contract version 2 gives the custom UI its own way to pick, and stays additive. The Addresses panel shows beside a custom UI whatever version it uses, so an operator can always copy an address from it.

- `ui_document` (`contract.js:95`) and `parse_message` (`:199`) accept versions 1 and 2 (`CONTRACT_VERSIONS`), and the host (`lib/driver-ui/host.js`) answers each document in its own version. `CONTRACT_VERSION` stays 1, for the shell's envelope. `parse_message` keeps its return shapes and the version is read separately with `message_version`. A version 1 envelope carrying `pick-address` or `scout-query` is ignored. Version 1 documents, such as Pathfindr's, are unchanged.
- The shell `acs-admin/public/driver-ui/host.html` accepts only envelope version 1 for its `document` message (`VERSION = 1`, `:34`). The shell stays on version 1, and only the messages between host and document use version 2.
- `init.scout = {available, state, finished, items}` tells the document whether a snapshot exists, and a host-to-document `{type:"scout-changed", scout:{...}}` message, with the same shape, tells it when a scan starts, finishes or fails.
- Document to host `{type:"pick-address", filter?:{prefix, kind}}` opens the host's own picker (`ScoutPicker.vue`) over the iframe. The host replies `{type:"picked", item}` with the item, minus `sample` unless the DriverDef sets `scout.share_samples: true`, or `{type:"picked", item:null}` when the operator closes the picker or there is no snapshot. The document then uses `propose` as today, under the same `PROPOSABLE` allowlist (`contract.js:52-62`). A second `pick-address` while the picker is open is answered `{type:"picked", item:null}` at once.
- Document to host `{type:"scout-query", prefix, limit}` with a limit of at most 500 answers `{type:"scout-items", items}`, the items whose `address` starts with `prefix`, in snapshot order and with the same `sample` rule, so a document can draw its own list. A larger `limit` is cut to 500, and with no snapshot `items` is empty.
- The document cannot start a scan. Third-party code in the sandbox never causes load on production equipment.

No driver in this repo has a version 2 document yet, so phase 1 adds `acs-admin/test/fixtures/driver-ui/scout-v2.html` and `test/driver-ui-v2-host.test.js`, a vitest test in jsdom that loads the real `public/driver-ui/host.html` in a frame, writes the document in, drives `pick-address`, `scout-query` and `scout-changed`, and checks that a version 1 document still gets version 1 answers. jsdom does not enforce the iframe sandbox, so the opaque-origin behaviour is checked by reading the code and in the dev-cluster pass. The provided `driverUiScout` object carries only `summary`, `index` and `pick`, so a custom UI has no path to start a scan, and contract tests check that scan-like message types never reach one.

## Re-scan and diff semantics

- **Address normalisers.** Before any comparison, the UI puts a metric's `Address` into the driver's canonical form with the normaliser named by the DriverDef's `scout.address_form`. `opcua` strips `ns=0;` and reduces any trailing index range of digits, `:` and `,` such as `node[2:5]` (`edge-opcua/src/addr.rs:72-91`) to its base node, unless the snapshot has an item for that exact address. `mqtt` and `exact` compare unchanged. Normalisers are built into `model.js`, so no code comes from ConfigDB.
- **Identity** is `address + "\0" + (path ?? "")`. Folders without an address match by `id`.
- **New**: in the current snapshot and not the previous. **Changed**: same identity, different `type`, `access`, `kind` or `detail.dims`. A different `name` shows as "renamed".
- **Comparable.** Two snapshots are comparable when both are exhaustive, neither is truncated, their `options_hash` and `root` match, and their `excluded` scopes match. **Gone** is shown only between comparable snapshots. Otherwise absent items show as "Not seen this time", or the change bar says the options differ. MQTT scans are never exhaustive, so they never report Gone.
- **Mapped but missing** lists metrics in this device's origin map whose normalised (Address, Path) is absent from the current snapshot, when the current snapshot has `root` null, is exhaustive and is not truncated, and the address is not placed inside a skipped part of the scan. An address is inside a skipped part when it starts with a prefix of an `excluded` scope. When the snapshot has any `excluded` scope without prefixes, or any folder with `more:true` or `detail.denied`, unfound addresses that no prefix places show as "Not seen" instead, because the scan cannot say where they would be. A mapped metric whose type conflicts with the discovered type gets a warning chip.
- **Branch scan merge.** The agent takes the current snapshot and the branch scan's items and:
  1. removes the folder whose `id` is `folder_id`, and every item whose parent chain in the current snapshot reaches it
  2. adds the branch scan's items, giving the first one (id `folder_id`) the parent the folder had
  3. drops any added item whose `id` is still present outside the removed subtree, keeping the outside copy, which removes OPC UA nodes that a second parent lists again
  4. sets the merged `exhaustive` to the AND of both scans, `truncated` to the OR, `reason` to the branch scan's reason when it is truncated and otherwise the base's, `excluded` to the union by `id` with the base's copy kept on a clash, `options_hash` and `root` to the base snapshot's, and appends `{folder_id, finished}` to `branches`, keeping the last 10

  A full scan (`folder_id` null) is not merged: its items and flags replace the base, and its `branches` is empty. Item order in a merged snapshot is not significant, so tests compare items by `id`, including each `parent`. The fixtures in `lib/edge-scout-schemas/fixtures/merge/` give the base, the scan and the expected result for each case, and every implementation tests against them.
  The change bar after a branch scan covers only that subtree. A `folder_id` that is not in the current snapshot ends the scan with `OPTIONS` before the driver is asked. The MQTT folder ids end in `/`, so the merge never confuses a folder with the topic of the same name.
- **Cancelled or failed** scans do not replace `current`.
- **Never automatic.** A scan never edits the origin map.

## Removal list

Step 1 removed every remnant of the old design that lived in this repo:

| Path | What step 1 did |
|---|---|
| `acs-edge/lib/translator.ts:410-415` | Deleted the "Edge Scout is not available" branch. The agent now ignores a stale `scout` key in a connection, which the fixup below removes |
| `acs-edge/docs/edge-split.md` | Replaced the "Split drivers have no address browsing" note and the old Edge Scout section with the normative "Scouting" section, and updated the summary table and the ACL table |
| `docs/assets/edge-agent-scout/acs-edge-scout-high-level-diagram.png` | Deleted, with its directory |
| `docs/architecture/edge-management/overview.md`, `edge-bootstrap.md`, `edge-deployments.md` | Removed the "Learn about the edge scout mode" links. The docs step added a link to the operator guide in `overview.md` and the new pages to `docs/index.md` |
| `docs/index.md` | Kept the navigation entry, because this page stays at the same path. The docs step grouped it with the new Edge Scout pages |

Removed by later steps or outside the code:

| Item | Action |
|---|---|
| `deviceConnections[].scout` in stored AgentConfig entries | Removed by the service-setup fixup in step 2 |
| The old design's ConfigDB app UUID | Never created on `dev`, so there is nothing to delete. Only the old doc mentioned it, and no new object reuses it |
| `origin/za/scout` | Not merged. Close it |

The old `Scout` class and `scoutAddresses` methods went with ACS 7. Keep the unrelated Gateway Depot scout (`acs-gateway-depot/lib/depot.js:84`).

## Test plan

This section records the tests as built. Each package's own tests run in its CI workflow.

### Validation

- JSON Schemas (draft 2020-12) for the `addr` packet with its features key, the `Node Control/Scout` NCMD request, the agent's `scout` messages, the `found` messages, ITEM, the status entry and the snapshot lines live in `lib/edge-scout-schemas/schemas/`, under `lib` because every service image is built with `lib` as a build context (`mk/acs.docker.mk:11`) and the service-setup image cannot read `acs-edge/`. The service-setup dump carries a copy of the status schema in `dumps/edge.yaml`, and a service-setup test fails when the copy and the file differ, in the style of `edge-pathfindr/test/ui-sync.test.js`. `service-setup-tests.yaml` also runs when the schema file changes.
- Shared fixtures in `lib/edge-scout-schemas/fixtures/{valid,invalid,merge}/*.json` (46 valid, 57 invalid, 6 merge) are loaded by the agent tests, the library and driver tests and the acs-admin model tests, so every implementation agrees on the same files. The package's own `node --test` suite (111 tests) checks every fixture against its schema, checks the merge fixtures against `test/reference-merge.js`, and checks that the largest possible status entry is 50,841 bytes. A snapshot's structure across lines (no end line, a count mismatch, a repeated id) is checked by `check_snapshot`, not a schema.

### Unit tests

- **acs-edge** (jest, `acs-edge-tests.yaml`, which also runs on `lib/edge-scout-schemas/**`): `tests/lib/scout/manager.test.ts` (55 tests) for validation and clamping, the compatibility rows including the 10 s `LIBRARY` wait, the state machine with short real timers (silence, deadline, cancel, `LOST`, `INTERRUPTED`), refusals written only to `last_request`, the hello written only on change, concurrency, caps, retention, the in-flight delete on `init()`, `STORE` mapping and the upload across a 401 retry. `tests/lib/scout/merge.test.ts` (18 tests) runs every merge fixture as a streamed merge and through a whole scan. `tests/lib/devices/driver.scout.test.ts` covers `found` not flushing data groups, and `tests/scout/agent.test.ts` runs the real Translator, DriverBroker and DriverConnection with a fake driver over real MQTT. `driverBroker.test.ts`, `sparkplugNode.test.ts` and `driver.test.ts` gained the ACL, subscriber map, `acl` option, NBIRTH and NCMD cases. The suite is 39 suites and 604 tests. Fake timers were not used, because the code under test mixes timers with async I/O.
- **Libraries**: `lib/js-edge-driver/test/scout.test.js` and `scout-mosquitto.test.js` (`js-edge-driver-tests.yaml`), `lib/rs-edge-driver/tests/scout.rs` and `scout_mosquitto.rs` with the `FakeAgent` in `tests/common` (`rust.yaml`), and `lib/py-edge-driver/tests/test_scout.py` and `test_scout_mosquitto.py` (`py-edge-driver.yaml`). Each covers the gate (feature read before the handler, version and address checks, a bad address map still subscribing), the reconnect to an old-ACL broker without a disconnect, hello from the class, batch splitting, caps, the watchdog with a hung handler, a second `start` giving `ERR`, cancel and cancel on `conf`, a throw or panic giving `ERR`, and the default `UNSUPPORTED`.
- **edge-opcua**: 25 unit tests in `src/scout/tests.rs` against a fake `Service`, plus a canonical-address round trip in `addr.rs`.
- **edge-mqtt**: 30 unit tests in `src/survey.rs` and `src/scout.rs` for the id scheme including a topic that is also a folder, JSON leaf paths, type inference, `$` filtering, retained messages left out of the flood rate, and client id derivation, and 11 tests in `tests/scout.rs` against the fake broker.
- **edge-test, edge-test-rs and edge-sim**: 28, 28 and 15 new tests, each with every message and item checked against the schemas, run by `edge-js-drivers.yaml` (Node 22) and `rust.yaml`.
- **edge-ftp and edge-pathfindr**: one test each (`test/scout.js` and `test/scout.test.js`) builds the driver on the in-repo library with its real handler class and no configuration, offers `features.scout`, and checks that it subscribes to `scout`, that its hello says `supported:false`, and that a scan ends `UNSUPPORTED`. The same test fails against the published 0.1.1 library. `edge-js-drivers.yaml` now runs both suites.
- **acs-admin** (vitest, `acs-admin-tests.yaml`, Node 24): `scout-model.test.js`, `scout-use.test.js`, `scout-ensure-metric.test.js`, `scout-bulk-map.test.js`, `scout-text.test.js`, `scout-panel.test.js` (jsdom mounts of the panel and the map dialog), `scout-worker.test.js` (the blob worker source run as a module, and a check that `snapshot.js` imports nothing), `driver-ui-contract.test.js` and `driver-ui-v2-host.test.js`. They cover every row of the states table with fake CmdEsc, watches, births and Files, a refusal in a second browser not disturbing the first, `ensure_metric` identity on selected, unselected and new metrics, bulk rows through `applyCsvToModel` including object names with `.` and `/`, and contract version 2. `vitest.config.js` now loads `@vitejs/plugin-vue` for the component mounts. The suite is 52 files and 1,423 tests.
- **acs-service-setup** (`service-setup-tests.yaml`): `test/edge-scout.test.js`, 30 tests, for the UUIDs, the objects, the load order, the schema copy, the DriverDef keys, the agent grants sitting only in `helm.yaml`, the admin grants, the scout strip including a 412 rebuild, and the sweep's keep and delete rules and order.
- **acs-files** (`acs-files-tests.yaml`, new): `test/harness.js` runs the real APIv1 router over a temporary directory with a stub Auth that expands class grants and a stub ConfigDB, and `test/api-v1.test.js` (17 tests) covers DELETE and the existing PUT, including its 409.

### Integration against a real OPC UA server

`edge-opcua/tests/server/server.cjs` loads the new `tests/server/scout.cjs` for a `SCOUT=1` mode: a 4,949-node tree 6 deep, a folder of 2,500 children, an `Organizes` cycle, a node with two parents, a branch denied to user `test`, arrays, an enumeration, a UtcTime, an AnalogItem with units, ByteString, LocalizedText and a structure, `MaxNodesPerBrowse` 10, and counters for open continuation points and refused Browses. Further settings are `SCOUT_SIZE`, `MAX_NODES_PER_BROWSE`, `MAX_NODES_PER_READ`, `HIDE_LIMITS`, `MAX_REFS_PER_NODE` and `BROWSE_DELAY_MS`. `edge-opcua/tests/scout.rs` (10 tests) asserts the exact item set, the Server object in `excluded`, the caps, cancel within 1 s with continuation points back to 0, `partial_access`, `BadTooManyOperations`, `CONN` after a server restart, the data rate during a scan, the options and the size of a 20,000-variable scan. `edge-opcua.yaml` does not yet run `--test scout` (see "Known gaps").

### Integration against a real MQTT broker

The spike ran mosquitto 2.1.4 (`eclipse-mosquitto:2`) and 2.0.21 with an `acl_file` and with the dynamic security plugin. Its result is in "edge-mqtt" above and in the edge-mqtt README. `edge-mqtt/tests/scout_mosquitto.rs` (6 tests, against mosquitto from `PATH`, as `tests/real` does) asserts `AUTH` and `partial_access` only under the dynamic security plugin, and otherwise asserts that denied topics are absent. With `tests/scout.rs` it covers retained and live topics, a topic that is also a folder, JSON leaves, binary payloads, `$SYS` exclusion, the caps, a retained burst of 10,000 topics that keeps its JSON leaves, the live flood cutoff, and that the main session never reconnects. It runs in `split-driver-golden.yaml` with `EDGE_MQTT_MOSQUITTO=1`, which needs the dynamic security plugin on the runner.

### End to end

`acs-edge/tests/scout/e2e.test.ts` runs the Edge Agent as its own Node process (`tests/scout/e2e/agent-main.ts`, a copy of `app.ts` compiled with the agent's tsconfig) rather than in process on `tests/golden/harness.ts`, so it has the real `@amrc-factoryplus/utilities` ServiceClient over HTTP, a real SIGKILL restart, and the agent's own memory and CPU. Auth, Directory, ConfigDB and Files are HTTP fakes on one port (`tests/scout/e2e/services.ts`). There is no cmdesc stub, because cmdesc's part ends at publishing the NCMD, so the test publishes the NCMD to mosquitto itself. The drivers are the real release builds of edge-opcua (against `server.cjs` in SCOUT mode), edge-mqtt and edge-test-rs, plus edge-test and a fake driver on the pre-scout protocol. `tests/scout/e2e/README.md` says how to run it.

16 of its 17 cases pass: the NBIRTH metric and one hello write per driver, a full OPC UA scan (7,504 items, 69,802 bytes gzipped, Server object excluded, the upload resent unchanged after a 401), a branch scan whose merged id-to-parent map equals the full scan's, three MQTT scans with the change list and retention order, `BUSY`, cancel and `NOTRUNNING`, `UNSUPPORTED`, `LIBRARY`, `INTERRUPTED` after SIGTERM and SIGKILL, the size cap and the item cap, and compatibility. Compatibility uses the broker's `acl` option: edge-test and edge-test-rs against the pre-v6.8.0 ACL, every driver against the ACS 7 agent from before scouting, this release and a rollback, never disconnected. edge-opcua and edge-mqtt cannot run against the pre-v6.8.0 ACL at all, because they subscribe to `write/#` at connect, which has nothing to do with scouting.

The load case runs a 49,950-item edge-test-rs scan at the default pace while edge-mqtt delivers a value every 50 ms, with the agent in a cgroup at 100m CPU and 200Mi (`limit.sh`), and measures latency from the test publishing a value to the DDATA reaching mosquitto. It fails: see "Risks" item 2. The rule uses a 10 ms floor for the baseline, so the test fails when the 95th percentile latency is more than 2 x max(baseline p95, 10 ms) or memory passes 180Mi. The size cap check allows the end line on top of `SCOUT_MAX_BYTES`, because the snapshot writer always writes the header and end lines.

The test is skipped unless `SCOUT_E2E=1` is set, and it writes a marker file listing each case, ending "all cases passed" only when every case passed, which `scout-e2e.yaml` checks afterwards. `tests/scout/e2e-harness.test.ts` checks the fakes and stand-in ACLs in the normal jest run.

The manual pass on a dev cluster (every panel state, two browsers, a non-admin user, an offline agent, an old agent, and a version 2 driver UI in a real browser) has not been done yet.

### CI workflows

`js-lib.yaml` is the npm publish workflow, not a test workflow. The build added:

- `js-edge-driver-tests.yaml`: the `lib/js-edge-driver` tests
- `py-edge-driver.yaml`: pytest in `lib/py-edge-driver`
- `acs-admin-tests.yaml`: the vitest suite on Node 24, for `acs-admin/**`, `lib/js-*/**` and `lib/edge-scout-schemas/**`
- `edge-js-drivers.yaml`: the tests of edge-test and edge-sim, and edge-test's lint, on Node 22
- `acs-files-tests.yaml`: the new acs-files harness
- `scout-e2e.yaml`: the end-to-end and load tests, using `sudo -E` with `limit.sh` and `setpriv` for the cgroup. It has not run on GitHub yet

## Documentation

- [Scanning a device for addresses](edge-scout-scanning.md): the operator guide, with every panel state, every code and what to do about it, re-scan and the change bar, bulk mapping and permissions. It has no screenshots, because the docs have no screenshot pipeline for the Admin UI and no dev-cluster pass has been run.
- [Edge Scout driver notes](edge-scout-driver-notes.md): what each driver finds, its options, caps and timeouts.
- [Adding scouting to a driver](edge-scout-drivers.md): the driver author guide with JS, Python and Rust examples, linked from `docs/development/rust-drivers.md`.
- [Edge Scout reference](edge-scout-reference.md): the command, protocol summary, codes, status entry, snapshot, retention, UUIDs, grants, Files `DELETE`, settings and the DriverDef key.
- `docs/architecture/edge-management/driver-custom-uis.md`: contract version 2.
- `docs/services/file-service.md`: the `DELETE` route and the `Delete` permission.
- `acs-edge/docs/edge-split.md`: the normative "Scouting" section, with the measured load figures and the ACS 7 note on compatibility.
- The library docs (`lib/js-edge-driver/docs/driver.md`, `lib/py-edge-driver/README.md`, `lib/rs-edge-driver/README.md` and rustdoc), the driver READMEs (edge-opcua, edge-mqtt, edge-test, edge-test-rs, edge-sim), `lib/edge-scout-schemas/README.md` and `acs-edge/tests/scout/e2e/README.md`.
- An entry in `docs/reference/release-notes.md`.

## Risks and open decisions

1. **Load on production equipment.** A full browse of a busy PLC server, or `#` on a plant broker, is real load. Pacing, backoff, server operation limits, samples off and a 10 s MQTT window keep it down, and sites can lower the caps.
2. **Load on the Edge Agent.** Memory is fine: peak RSS was 120 to 131 MiB during a 49,950-item scan under the chart's 200Mi. CPU is not. At 100m CPU the scan uses the whole quota for 30 to 50 s, CFS throttling stalls the agent's event loop, and DDATA latency p95 rises from about 20 ms to 350 to 720 ms (worst case about 2 s) at `pace_ms` 0 to 20. It falls to 155 ms at pace 100 and 108 ms at pace 200, which makes the scan take twice as long. Without a CPU limit the same scan needs about 1.3 CPU-seconds and does not change latency. The load case in `scout-e2e.yaml` fails until one of these is chosen: (a) accept a looser rule, such as p95 at most 2 x baseline + 100 ms (one CFS period), (b) raise the agent's default pace or have the agent limit how fast it handles items under a CPU limit, or (c) document that scans add up to one CFS period of latency. The operator guide describes the effect as it stands.
3. **Files Upload is global.** Files checks Upload against `Special.Null` (`acs-files/lib/api-v1.js:96-103`), so an agent could fill any empty File object. A later Files change can check the object's class.
4. **Files is unowned code**, so the DELETE route stays small and has the first tests acs-files has had. A Files upload in progress is not stopped by DELETE, so an upload that finishes after a delete leaves content behind. The agent never deletes a snapshot while uploading it.
5. **Schema pin.** Checked in step 1, and not needed. The Edge Agent's NBIRTH schema (`Edge_Agent-v1`, UUID `15360868-…`) comes from the external acs-schemas image pinned in `deploy/values.yaml`, but it defines only `Schema_UUID`, `Instance_UUID`, `Config_Revision` and `Alerts`, and does not close the object, so `Node Control/Scout` needs no acs-schemas release, as `Node Control/Rebirth` never did. The NBIRTH recordings in `acs-edge/tests/golden/recorded/` were updated by hand.
6. **OPC UA namespace indexes** can change after a server rebuild. `detail.namespace_uri` records the URI, and `nsu=` addresses are a later change.
7. **MQTT broker behaviour.** Under a mosquitto `acl_file`, the common setup, denied topics are silently filtered, so a scan under a narrow ACL can look complete when it is not. MQTT scans are never exhaustive, so the UI never calls anything gone or missing because of it.
8. **MQTT client id.** A broker with strict client-id ACLs may refuse `<clientId>-scout-...`, so the options allow `client_id`. The scan opens a second connection to the broker, which a broker with a per-user connection limit may refuse.
9. **Estimates.** Measured: see "Result storage". The gzipped size on real servers is still unknown, because the test names compress very well.
10. **One release.** With no feature flag, an agent of this release scans as soon as it runs. The dumps, grants and Files route ship in the same release, so they normally exist before any agent scans. If an agent from this release runs against an older central install, its status and snapshot writes fail, the scan ends with `STORE`, and the agent logs the Files or ConfigDB answer. A driver on an older library answers `LIBRARY`.
11. Cross-agent writes, UI scope, device-less connections and the OPC UA Server object are settled by decisions 3, 5, 6 and 7.

## Known gaps

These were found during the build or while writing the docs, and are open at the time of writing.

- **The load case fails** (risk 2), so `scout-e2e.yaml` will be red until the rule or the agent changes.
- **The OPC-UA "Start at" option does nothing.** The OPC-UA DriverDef lists a `root` option, which the UI sends inside `options`, and edge-opcua ignores unknown options and reads the scan root only from the request's `root`. Either the option goes from the DriverDef, or the UI moves it into the request's `root`. Branch scans work, because they set `root` directly.
- **The "Driver not running" banner repeats itself.** The agent stores a full sentence in `last_request.message` ("The driver isn't ready. Its status is CONF."), and `state_banner` in `acs-admin/src/lib/scout/text.js` expects a bare status such as `CONF`, so the banner reads "The driver isn't ready. It reported The driver isn't ready. Its status is CONF..". Either the UI reads the status out of the message or shows the message as it is.
- **OPC UA Guid case.** async-opcua prints Guid identifiers lower case, so a metric typed `ns=3;g=72962B91-...` never matches a scan. The `opcua` normaliser should lower-case a `g=` identifier.
- **Byte order for edge-test.** edge-test items carry a plain type and the byte order in `detail.byte_order`. The UI's rule (plain name, then `BE`, then `LE`) gives `DoubleBE` for an `ld` address. The UI could use `detail.byte_order` when it is there.
- **The two test drivers build different trees.** edge-test and edge-test-rs share a DriverDef `scout` key but list different trees, and accept slightly different options (`after` and `UNSUPPORTED` only in edge-test, `PANIC` only in edge-test-rs). The DriverDef's option descriptions do not say this.
- **CI for edge-opcua's scan tests.** `edge-opcua.yaml` does not yet pass `--test scout`, and does not trigger on `lib/edge-scout-schemas/**`, so `tests/scout.rs` runs only locally. `rust.yaml` does not trigger on `lib/edge-scout-schemas/**` either, so a schema change alone does not rerun the Rust crates' schema checks.
- **The edge-agent chart** does not set `SCOUT_MAX_CONCURRENT`, `SCOUT_MAX_BYTES` or `SCOUT_MAX_GZ_BYTES`, so they can only be changed by editing the deployment.
- **UUIDs in the service client.** `lib/js-service-client` does not export the three Edge UUIDs yet, so acs-admin keeps local copies in `src/lib/scout/constants.js`, and the fixup and the agent call Files `DELETE` through `fplus.Fetch`.
- **No dev-cluster pass yet.** Nobody has scanned a real device from the Admin UI against a live agent, or opened a version 2 driver UI in a real browser.
- `origin/za/scout` is still an unmerged remote branch from the old design, and should be closed.

## Work breakdown

Everything below was phase 1 and ships in one release. Steps 1 to 14 are built. Step 15, the dev-cluster trial, is still to do.

| # | Work | Days |
|---|---|---|
| 1 | Removal, protocol text in `edge-split.md`, UUIDs in this spec, `lib/edge-scout-schemas` and shared fixtures | 2 |
| 2 | Service-setup UUIDs, dumps, grants, schema copy and sync test, fixups, Files DELETE route, acs-files test harness | 4 |
| 3 | Agent: ACL and test seam, features, flush exemption, NCMD, NBIRTH and golden re-record, `ScoutManager`, Files and ConfigDB, streamed merge, retention, recovery, tests | 6 |
| 4 | rs-edge-driver `Scouter`, sink, per-session gate, watchdog, tests | 3 |
| 5 | js-edge-driver and py-edge-driver, tests | 4 |
| 6 | edge-opcua scouter, `excluded`, server.cjs mode, integration tests, size measurement | 4.5 |
| 7 | edge-mqtt scouter, broker ACL spike, mosquitto tests | 3.5 |
| 8 | edge-test, edge-test-rs, edge-sim scouters | 1.5 |
| 9 | Admin UI: composable with births, worker, panel, tree, every state, pick, drag with `ensure_metric`, reverse view, normalisers, diff | 10 |
| 10 | Admin UI bulk mapping: map dialog, auto-match, object creation, through the CSV path | 3 |
| 11 | Driver custom UI contract version 2: `pick-address`, `scout-query`, `scout-changed`, the picker, the version 2 test document and its test | 2 |
| 12 | CI workflows for js-edge-driver, py-edge-driver, acs-admin, JS drivers and acs-files | 2 |
| 13 | End-to-end harness, compatibility cases, load measurement, `scout-e2e.yaml` | 4 |
| 14 | Docs: the operator guide, driver notes, driver author guide, reference, `driver-custom-uis.md` and this page | 3 |
| 15 | Dev-cluster trial and review fixes | 2 |
| | **Total** | **about 55 days** |
