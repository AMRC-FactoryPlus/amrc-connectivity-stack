# Adding scouting to a driver

This page shows how to make a split driver list its device's addresses
for Edge Scout, in JavaScript, Python and Rust. The driver libraries do
the whole protocol with the Edge Agent, so a driver only has to walk
its device and hand over what it finds. What operators see is in
[Scanning a device for addresses](edge-scout-scanning.md), and the
formats are in the [Edge Scout reference](edge-scout-reference.md).

The normative protocol is the "Scouting" section of
[`acs-edge/docs/edge-split.md`](../../../acs-edge/docs/edge-split.md).
You only need it if you write a driver without one of the libraries.

## What the library does and what you do

The library, in all three languages:

- subscribes to `fpEdge1/<Conn>/scout` only after the Edge Agent's
  `addr` packet carries `features.scout`, and forgets that on every
  reconnect, so a new driver never upsets an older Edge Agent
- answers the Edge Agent's hello from the handler class, so a driver
  whose configuration failed still answers correctly
- numbers the messages, splits items into batches of at most 500 items
  and 256 KiB, and sends progress at least every 5 s
- clamps the limits, ends the scan at the item cap and at
  `limits.seconds` even if your code hangs, and stops it on a cancel
  or a new driver configuration
- drops items with no `id`, drops `sample` unless the scan asked for
  samples, and turns an exception or panic into an `ERR` ending
- runs one scan at a time and refuses a second `start` with `ERR`

You:

1. Mark the handler class as able to scan.
2. Walk the device from `root`, or from its natural top when `root` is
   null, and add an item for each folder and value you find.
3. Keep to `limits.depth`, call `pace()` between requests to the
   device, and stop when the scan is stopped.
4. Return how the scan ended, or throw an error with a code.
5. Add a `scout` key to the driver's definition.

Without step 1 the driver answers every scan with `UNSUPPORTED`, which
the Admin UI shows as "This driver can't list its addresses."

## The rules for items

These rules matter more than any code, because the Admin UI compares
scans and matches items to metrics with them.

- **`id` comes from the device alone.** Never build it from the scan's
  `root`, a counter or the order of the walk. A node must get the same
  `id` in a full scan and in every branch scan, or a branch scan
  cannot replace the folder it re-scans. A NodeId, a topic or a tag
  name is a good `id`. It must be unique in the scan and at most 512
  characters.
- **`address` is canonical.** A value's `address` must parse with the
  driver's own address parser and be in the form the driver prints
  from a parsed address. An operator's metric uses that address, so
  the driver must read exactly the value the item describes.
- **`path` matches the metric's `Path`.** Use it for a part of the data
  packet, such as a JSONPath into a payload. Leave it null when a
  metric reads the whole packet. The pair (address, path) is what the
  Admin UI binds to a metric.
- **`kind` is `folder` or `value`.** A folder is structure only and
  cannot be bound. A value can be bound, and may also have children.
  If a thing can be both, as an MQTT topic with topics under it can,
  list a value and a separate folder with a different `id`.
- **`type` is a plain Sparkplug B name** such as `Int16`, `Double` or
  `String`, without `BE` or `LE`, or null when you cannot tell.
- **`more: true`** on a folder says it has children the scan did not
  list, for example at the depth cap. The operator can then scan that
  branch.
- **`root`** on a folder is what to send back as `root` to scan that
  folder alone, when that is not the folder's `id`. The MQTT driver
  uses it for `plant/line1/#`.
- **Branch scans.** When `folder_id` is set, the scan re-scans that
  folder. Its first item must be the folder itself, with `id` equal to
  `folder_id`. The Edge Agent fixes up that item's parent.
- **`excluded`** lists, in the result, parts of the device the scan
  skipped on purpose, with address prefixes that fall inside them when
  you can give them. The Admin UI then never calls an address in them
  missing. edge-opcua uses `{id: "i=2253", reason: "skipped",
  prefixes: ["i="]}` for the OPC UA Server object.
- **`exhaustive`** is true when your walk can find everything there is
  within the caps, as an OPC UA browse can. It is false when a quiet
  thing can be missed, as with an MQTT listen. Only exhaustive scans
  can say an address is gone.
- **Strings come from the device.** The Admin UI shows them as text
  only, and the Edge Agent cuts them to length: `name` 256 characters,
  `address`, `path` and `description` 1024, `unit` 64, `sample` 256,
  and `detail` 2 KiB as JSON.

The codes you may end a scan with are `OPTIONS` (a bad `root`,
`folder_id` or option, with a message that says which), `CONN` (the
device cannot be reached), `AUTH` (the device refused the driver) and
`ERR` (anything else). The library sends `UNSUPPORTED` and `CANCELLED`
itself.

## JavaScript

`lib/js-edge-driver` exports `ScoutError` and `ScoutStopped`. The full
interface is in
[`lib/js-edge-driver/docs/driver.md`](../../../lib/js-edge-driver/docs/driver.md),
and [`edge-sim/lib/scout.js`](../../../edge-sim/lib/scout.js) is the
reference scouter.

The example walks a device whose client can look up a node and list a
node's children. It is breadth first, applies the depth cap and
handles branch scans.

```js
import { ScoutError } from "@amrc-factoryplus/edge-driver";

/* One item for one node of the device. The id and the address both
 * come from the device, and the address is printed in the driver's
 * own canonical form. */
function to_item (node) {
    const item = {
        id:     node.id,
        parent: node.parent_id ?? null,
        name:   node.name,
        kind:   node.is_folder ? "folder" : "value",
    };
    if (!node.is_folder) {
        item.address = node.address;
        item.type = node.type ?? null;          // "Double", "Int16"...
        item.access = node.writable ? "rw" : "r";
        item.description = node.description ?? null;
    }
    return item;
}

export class FooHandler {
    /* Without this every scan ends UNSUPPORTED. */
    static scouts = true;

    /* create, connect, parseAddr, subscribe and close as for any
     * other handler. */

    async scout (req, out) {
        const { root, folder_id, limits } = req;
        if (!this.client?.connected)
            throw new ScoutError("CONN", "The driver is not connected to the device");

        let start = null;
        if (root != null) {
            start = await this.client.lookup(root);
            if (!start?.is_folder)
                throw new ScoutError("OPTIONS", `${root} is not a folder on this device`);
            if (folder_id != null && folder_id != start.id)
                throw new ScoutError("OPTIONS", "folder_id must be the id of the root folder");
            /* A branch scan sends the folder itself first. */
            if (folder_id != null)
                await out.add(to_item(start));
        }

        let truncated = false;
        let visited = 0;
        /* null stands for the device's natural top. */
        let level = [start];
        for (let depth = 1; level.length && !out.signal.aborted; depth++) {
            const next = [];
            for (const folder of level) {
                await out.pace();
                const children = await this.client.list(folder?.id ?? null);
                visited += children.length;

                const items = children.map(child => {
                    const item = to_item(child);
                    if (child.is_folder) {
                        if (depth < limits.depth)
                            next.push(child);
                        else if (child.has_children) {
                            item.more = true;
                            truncated = true;
                        }
                    }
                    if (limits.samples && !child.is_folder)
                        item.sample = String(child.value);
                    return item;
                });
                /* Rejects with ScoutStopped once the scan has stopped.
                 * Let it escape: the library ends the scan correctly. */
                await out.add(items);
                out.progress({ visited, note: folder?.id ?? null });
            }
            level = next;
        }

        return {
            exhaustive: true,
            truncated,
            reason:     truncated ? "depth" : null,
            excluded:   [],
        };
    }
}
```

`out` has:

- `add(items)` takes one item or an array, and resolves once they are
  queued, so the handler slows to the speed of the broker. It rejects
  with `ScoutStopped` once the scan has stopped, including at the item
  cap.
- `progress({visited, note})` records how far the scan has got.
- `pace()` resolves after `limits.pace_ms`, or at once when the scan
  stops.
- `signal` is an `AbortSignal` that aborts when the scan stops. Pass it
  to anything that can take one.
- `limits` is the same as `req.limits`.

The library also drops items deeper than `limits.depth`, working depth
out from each item's parent, and then ends the scan truncated with
reason `depth`. Do the depth check yourself anyway, as above, so the
folders at the cap carry `more: true` and the device is not walked
further than needed. After the scan stops, `scout` has 2 s to return
before the library ends the scan without it.

## Python

`lib/py-edge-driver` exports `ScoutEnd`, `ScoutError`, `ScoutRequest`,
`ScoutSink` and `ScoutStopped`. The library README has the details.

```python
from amrc.factoryplus.edge_driver import Handler, ScoutEnd, ScoutError


def to_item(node):
    item = {
        "id": node.id,
        "parent": node.parent_id,
        "name": node.name,
        "kind": "folder" if node.is_folder else "value",
    }
    if not node.is_folder:
        item["address"] = node.address
        item["type"] = node.type
        item["access"] = "rw" if node.writable else "r"
        item["description"] = node.description
    return item


class FooHandler(Handler):
    # Without this every scan ends UNSUPPORTED.
    scouts = True

    # create, connect, parseAddr, subscribe and close as for any other
    # handler.

    async def scout(self, request, out):
        limits = request.limits
        if not self.client.connected:
            raise ScoutError("CONN", "The driver is not connected to the device")

        start = None
        if request.root is not None:
            start = await self.client.lookup(request.root)
            if start is None or not start.is_folder:
                raise ScoutError("OPTIONS", f"{request.root} is not a folder on this device")
            if request.folder_id is not None and request.folder_id != start.id:
                raise ScoutError("OPTIONS", "folder_id must be the id of the root folder")
            # A branch scan sends the folder itself first.
            if request.folder_id is not None:
                await out.add(to_item(start))

        truncated = False
        visited = 0
        level = [start]  # None stands for the device's natural top
        depth = 1
        while level and not out.cancelled.is_set():
            next_level = []
            for folder in level:
                await out.pace()
                children = await self.client.list(folder.id if folder else None)
                visited += len(children)

                items = []
                for child in children:
                    item = to_item(child)
                    if child.is_folder:
                        if depth < limits["depth"]:
                            next_level.append(child)
                        elif child.has_children:
                            item["more"] = True
                            truncated = True
                    if limits["samples"] and not child.is_folder:
                        item["sample"] = str(child.value)
                    items.append(item)

                # Raises ScoutStopped once the scan has stopped. Let it
                # escape: the library ends the scan correctly.
                await out.add(items)
                out.progress(visited=visited, note=folder.id if folder else None)
            level = next_level
            depth += 1

        return ScoutEnd(
            exhaustive=True,
            truncated=truncated,
            reason="depth" if truncated else None,
        )
```

`request` is a `ScoutRequest` with `root`, `folder_id`, `options` and
`limits`, a dict with `items`, `depth`, `seconds`, `pace_ms` and
`samples`. `out` is a `ScoutSink`:

- `await out.add(items)` takes one item or a list, waits while batches
  go out, and raises `ScoutStopped` once the scan has stopped.
- `out.progress(visited=..., note=...)` records how far the scan has
  got.
- `await out.pace()` waits `pace_ms`, and wakes early when the scan
  stops.
- `out.cancelled` is an `asyncio.Event` that is set when the scan
  stops.

Return a `ScoutEnd`, a dict with the same keys, or `None`. A handler
that has not returned 2 s after the scan stopped is cancelled.

## Rust

`lib/rs-edge-driver` exports `Scouter`, `ScoutSink`, `ScoutRequest`,
`ScoutEnd`, `ScoutError`, `Item`, `ScoutType`, `Access`, `Progress`,
`Excluded`, `Truncation`, `Stop` and `CancellationToken`. The library
README and rustdoc have the details, and
[`edge-test-rs/src/scout.rs`](../../../edge-test-rs/src/scout.rs) is the
smallest real scouter.

A Rust scan runs on its own task, without the handler's lock, so polls
and writes carry on during a scan. The handler hands out a `Scouter`,
usually a small struct holding a clone of the device client, in the
same way as a `Poller`.

```rust
use std::sync::Arc;

use async_trait::async_trait;
use rs_edge_driver::{
    Access, Handler, Item, Progress, ScoutEnd, ScoutError, ScoutRequest, ScoutSink,
    ScoutType, Scouter, Truncation,
};

use crate::client::{FooClient, Node};

#[async_trait]
impl Handler for FooHandler {
    // Without this every scan ends UNSUPPORTED and scouter() is never
    // called.
    const SCOUTS: bool = true;

    // The library asks for a scouter after each successful connect.
    // None means there is no connection, and a scan ends with CONN.
    fn scouter(&self) -> Option<Arc<dyn Scouter>> {
        let client = self.client.clone()?;
        Some(Arc::new(FooScouter { client }))
    }

    // create, connect, parse_addr, subscribe and close as for any
    // other handler.
}

pub struct FooScouter {
    client: Arc<FooClient>,
}

fn to_item(node: &Node) -> Item {
    let parent = node.parent_id.as_deref();
    if node.is_folder {
        return Item::folder(&node.id, parent, &node.name);
    }
    let access = if node.writable { Access::ReadWrite } else { Access::Read };
    let mut item = Item::value(&node.id, parent, &node.name, &node.address)
        .with_type(ScoutType::Double)
        .with_access(access);
    if let Some(d) = &node.description {
        item = item.with_description(d);
    }
    item
}

#[async_trait]
impl Scouter for FooScouter {
    async fn scout(&self, req: ScoutRequest, sink: ScoutSink) -> Result<ScoutEnd, ScoutError> {
        let limits = sink.limits();

        let start = match &req.root {
            None => None,
            Some(root) => {
                let node = self
                    .client
                    .lookup(root)
                    .await
                    .map_err(|e| ScoutError::conn(e.to_string()))?
                    .filter(|n| n.is_folder)
                    .ok_or_else(|| ScoutError::options(format!("{root} is not a folder")))?;
                if let Some(folder_id) = &req.folder_id {
                    if *folder_id != node.id {
                        return Err(ScoutError::options("folder_id must be the root's id"));
                    }
                    // A branch scan sends the folder itself first.
                    sink.add(vec![to_item(&node)]).await?;
                }
                Some(node)
            }
        };

        let mut truncated = false;
        let mut visited = 0;
        let mut level: Vec<Option<Node>> = vec![start];
        let mut depth = 1;
        while !level.is_empty() {
            let mut next = Vec::new();
            for folder in &level {
                // Returns Stop::Cancelled once the scan is stopped, and
                // ? hands it to the library, which ends the scan.
                sink.pace().await?;
                let id = folder.as_ref().map(|f| f.id.as_str());
                let children = self
                    .client
                    .list(id)
                    .await
                    .map_err(|e| ScoutError::conn(e.to_string()))?;
                visited += children.len() as u64;

                let mut items = Vec::with_capacity(children.len());
                for child in children {
                    let mut item = to_item(&child);
                    if child.is_folder {
                        if depth < limits.depth {
                            next.push(Some(child));
                        } else if child.has_children {
                            item = item.with_more(true);
                            truncated = true;
                        }
                    }
                    items.push(item);
                }
                // At the item cap this returns Stop::Items, and ? ends
                // the scan as truncated.
                sink.add(items).await?;
                let mut p = Progress::new(visited);
                if let Some(id) = id {
                    p = p.with_note(id);
                }
                sink.progress(p);
            }
            level = next;
            depth += 1;
        }

        let end = ScoutEnd::new(true);
        Ok(if truncated { end.truncated(Truncation::Depth) } else { end })
    }
}
```

Points to know:

- `sink.add` and `sink.pace` return `Result<(), Stop>`. Return a `Stop`
  with `?`, and the library ends the scan correctly: truncated at the
  item cap, `CANCELLED` after a cancel.
- `sink.cancelled()` gives a `CancellationToken` to pass to anything
  long-running, such as a `tokio::select!` around a slow request.
- `add` waits while the data waiting to go to the Edge Agent is over
  half the publish queue, so scan output gives way to data.
- The library does not see the device's structure, so a Rust scouter
  must keep to `limits.depth` itself, as above.
- The library ends the scan at `limits.seconds` even if `scout` never
  returns, aborts a scouter that has not stopped 3 s after a cancel,
  and turns a panic into `ERR`.
- `ScoutEnd::exclude(Excluded::new("i=2253", "skipped").with_prefixes(["i="]))`
  reports a part of the device the scan skipped on purpose.

## The driver definition

Add a `scout` key to the driver's `Edge.App.DriverDef` entry, in the
same dump as its `schema` and `presentation`:

```yaml
scout:
  title: "Scan the device's tags"   # tooltip on the Scan button
  address_form: exact               # opcua, mqtt or exact
  options:                          # JSON Schema for the options form
    type: object
    properties:
      include_system:
        title: "Include system tags"
        type: boolean
        default: false
  share_samples: false              # let a custom driver UI see samples
```

- `address_form` names how the Admin UI compares a metric's address
  with a scanned one. Use `exact` unless the driver accepts more than
  one spelling of the same address, and if it does, ask for a
  normaliser in `acs-admin/src/lib/scout/model.js`. No code comes from
  the DriverDef.
- The Admin UI builds an options form from `options.properties` and
  sends the values, defaults included, as the request's `options`.
  Read only the options you list, and refuse values you cannot use
  with `OPTIONS`. Do not list an option your driver ignores.
- `scout: false` hides the Addresses panel. A driver with no `scout`
  key gets the panel, and its hello decides what it shows.

## Testing

`lib/edge-scout-schemas` has a JSON Schema for every message and item,
and fixtures under `fixtures/valid`, `fixtures/invalid` and
`fixtures/merge`. Check your driver's output against them with a
draft 2020-12 validator, as the drivers in this repository do:

- JavaScript: `ajv/dist/2020.js` with `ajv-formats`, or the
  package's own `load_schemas` and `check_snapshot`
- Python: `jsonschema`'s `Draft202012Validator`
- Rust: `jsonschema` 0.33 as a dev-dependency, without default
  features

Test at least: a full scan, a branch scan whose items and parents
equal the full scan's subtree, the depth cap giving `more: true`, a
bad root giving `OPTIONS`, a cancel ending within a second or two, and
that the driver keeps sending data during a scan. Each library has a
fake Edge Agent in its tests that you can copy.

## Without a library

A driver that does not use one of the three libraries must follow the
"Scouting" section of `edge-split.md` in full. The parts that matter
most:

- Read `features` first in every `addr` packet, before checking
  `version` or the addresses.
- Subscribe to `scout` only after seeing `features.scout` equal to 1 on
  the current MQTT session, at most once a session, and never on
  connect. Subscribing to `scout` on an Edge Agent from before this
  release gets the driver disconnected, so a driver that subscribed
  unconditionally would reconnect forever.
- Answer every `hello` on `found/hello` with `seq` 0.
- Number every other message on `found/<id>` from 0 with no gaps, and
  send exactly one `end`.
- Never hold up `data` messages to send `found` messages.
