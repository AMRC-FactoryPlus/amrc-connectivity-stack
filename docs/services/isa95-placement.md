# ISA-95 placement

Every device has an ISA-95 placement: its position in the ISA-95
vocabulary, stored once in ConfigDB. The placement decides whether the
device is on the UNS and where. This page describes how the placement
is stored, how it reaches the device's birth certificate, how existing
devices get one, and how you manage placements in the Manager UI.

## How it fits together

```
 Manager UI / bulk import / migration
                |
                v
 ConfigDB  ISA-95 Placement app      { node: <vocabulary node>, instances?: {...} }
                |
                |  render_isa95()   (lib/js-service-client, shared)
                v
 ConfigDB  Edge Agent config tags    Device_Information/ISA95_Hierarchy/...
   (written by the placement watcher, and by the Manager UI when it builds a config)
                |
                v
 Edge Agent DBIRTH --> UNS ingester --> UNS/v1/<Enterprise>/.../Edge/<device>/...
                                   \--> UNS historian, i3X
```

i3X reads the placement directly, so it lists the same devices at the
same positions as the UNS.

## The placement app

The **ISA-95 Placement** app (`f9345c57-14e3-4027-b76d-2b0b67eb8fed`)
holds one config per device:

```json
{
  "node": "<UUID of an ISA-95 vocabulary node>",
  "instances": {
    "Device_Information/ISA95_Hierarchy": "<Instance_UUID>"
  }
}
```

- `node` is the deepest vocabulary node the device sits at. It can be
  at any level, from Enterprise down to Work Unit.
- The levels above the node are not stored. They come from the
  vocabulary: each node's parent is the node whose `children` list
  (ISA-95 Vocabulary app) contains it, and its name is its Info name.
  Renaming or moving a vocabulary node therefore moves every device
  placed at or under it.
- `instances` is optional. It holds Instance_UUIDs to reuse, by object
  path, so that a device keeps the history keys it already had. The
  migration fills it in. Without it, Instance_UUIDs are the v5 UUIDs
  acs-edge would mint for the device and path, so they never change.

ConfigDB checks every placement it stores:

- The ConfigSchema checks the shape.
- A special app checks that `node` is a member of exactly one ISA-95
  level class, and that the chain from it to its Enterprise is clean:
  every node on the way has exactly one parent, one level up. ConfigDB
  answers `422` to a placement that fails.

Any principal can read placements, as for the vocabulary.

## The UNS rule

A device is on the UNS when its birth has a Hierarchy-v1 object
(`84ac3397-f3a2-440a-99e5-5bb9f6a75091`) at exactly
`Device_Information/ISA95_Hierarchy`, with a non-empty Enterprise. The
levels are read in order (Enterprise, Site, Area, Work Center, Work
Unit; the last two are spelled with spaces), trimmed, and reading stops
at the first empty one. A value that contains `/`, `+`, `#` or NUL, or
that is the word `Edge`, cannot go in a topic, and the device is left
off the UNS.

The rule lives in `lib/js-service-client/lib/isa95.js`. The UNS
ingester, i3X, the Manager UI, service-setup and the placement watcher
all use it. A hierarchy anywhere else in a birth, such as
`Device_Information/Base_Device_Information/ISA95_Hierarchy`, does not
count.

## Rendering a placement into the Edge Agent config

`render_isa95(placement, vocabulary, device)` turns a placement into
Edge Agent config tags:

- `Device_Information/ISA95_Hierarchy/Schema_UUID` and `Instance_UUID`;
- one String tag per level, down to the placed node, not recorded to
  the historian;
- `Device_Information/Schema_UUID` and `Instance_UUID`, which are added
  only when the device has no such tags.

`merge_isa95_tags` removes every tag whose name contains
`ISA95_Hierarchy` (at the root, nested, or set by hand) and adds the
rendered tags. Every writer uses it, so the device always births exactly
one hierarchy, from its placement.

A device's entry in an Edge Agent config is found by its
`Instance_UUID` tag, whose value is the device UUID. An entry with no
`Instance_UUID` tag (a device whose origin map is still empty) is
skipped and logged until the device has an origin map.

## The placement watcher

`acs-placement-watcher` is a small service that keeps Edge Agent
configs in step with placements. It follows the placement app, the
vocabulary, the level classes and the vocabulary nodes' names through
ConfigDB change notifications. Whenever a device's rendering changes,
it patches only that device's hierarchy tags in its node's Edge Agent
config:

- A placement is created or changed: the device gets the new hierarchy.
- A placement is removed: the device's hierarchy tags are removed.
- A vocabulary node is renamed or moved: every device placed at or
  under it gets the new hierarchy.
- A placement that does not render (for example, its node now has two
  parents) is logged, and the device's tags are left as they are.

It writes with `If-Match` on the config's ETag and retries when someone
else wrote first. When it starts, it renders every placement, which
repairs anything missed while it was not running. The monitor then sees
the new config and tells the Edge Agent to reload it, and the agent
rebirths the device.

Its principal, `sv1placementwatcher`, has its own service role with
read access to the placement app, the vocabulary, Info,
DeviceInformation and Edge Agent configs, and write access to Edge
Agent configs. It has no other rights.

Chart values, under `placementWatcher`:

| Value | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Run the watcher. Without it, placements reach a device only when someone saves it in the Manager UI. |
| `verbosity` | `ALL,!service,!token` | Debug log selection. |
| `debounceMs` | `500` | How long to wait for a burst of changes to finish before rendering. |
| `resources` | `{}` | Container resources. |

## The migration

service-setup runs a step called `migrate_isa95_placement` on every
install and upgrade. For each member of the Device class that has a
DeviceInformation config and no placement, it creates one:

1. If the origin map has a valid hierarchy at
   `Device_Information/ISA95_Hierarchy`, it uses that.
2. Otherwise it searches the whole origin map for any object with the
   Hierarchy-v1 Schema_UUID and a non-empty Enterprise, for example
   `Device_Information/Base_Device_Information/ISA95_Hierarchy` or one
   under a safety sub-object. It prefers the root one; otherwise it
   takes the last one found, which is the one the UNS ingester used to
   publish. It logs devices with more than one.
3. It matches the names to vocabulary nodes level by level, by name or
   alias, ignoring case and surrounding spaces. A name that does not
   match is created as a new node under the matched parent, because
   devices already publish under these names.
4. It copies the hierarchy's Instance_UUID into `instances`.
5. A device with no hierarchy anywhere is placed at the Enterprise
   named by the chart value `acs.organisation`, which is created if it
   does not exist.

The step never writes an origin map and never replaces a placement, so
running it again does nothing. A hierarchy whose values cannot go in a
topic is logged and the device is left unplaced, for you to place by
hand. The step logs a summary with counts.

After the migration, every `ISA95_Hierarchy` entry in an origin map is
ignored. You can leave them in place.

## Managing placements in the Manager UI

- **New device.** The new device dialog has a required placement
  picker. Choose at least an Enterprise. The placement is written
  before the device information, so the first Edge Agent config already
  has the hierarchy.
- **Device page.** The ISA-95 Placement panel shows for every device.
  It shows the device's path, or why the device is not on the UNS.
  Choosing a level writes the placement; you can also clear it.
- **Device lists.** The node page's device table shows each device's
  placement, with a **Not placed** or **Broken placement** badge for
  devices that are not on the UNS, and a **UNS** filter.
- **Import placements.** On the ISA-95 page, **Import placements**
  takes a CSV with the columns
  `device_uuid, Enterprise, Site, Area, Work Center, Work Unit`
  (a header line is optional; trailing empty levels can be left out).
  Each row must match existing vocabulary nodes and pass the topic
  rule. The dialog shows a preview of the changes and of any errors.
  Applying it writes placements only. It fills only devices with no
  placement unless you tick **Overwrite existing placements**. Running
  it again with the same file changes nothing.
- **Merge into.** On the ISA-95 page, select a duplicate node and use
  **Merge into** to merge it into another node of the same level. Its
  children move to the target, its name and aliases become aliases of
  the target, every device placed on it moves to the target, and it is
  deleted.
- **Delete.** A vocabulary node with devices placed at or under it
  cannot be deleted. Move or merge them first.
