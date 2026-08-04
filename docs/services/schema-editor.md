# Schema Editor

The schema editor lets an engineer author Factory+ metric schemas from
the ACS admin UI, without writing YAML or using git. It lives under
**Schemas** in the admin navigation.

## Where schemas live

The ConfigDB is the source of truth for a deployment's schemas. Every
schema is an object in the `Metric schema` class
(`83ee28d4-023e-4c2c-ab86-12c24e86372c`) with three config entries:

| Application | Holds |
|---|---|
| `b16e85fb-53c2-49f9-8d83-cdf6763304ba` | the JSON Schema body |
| `32093857-9d29-470e-a897-d2b56d5aa978` | name, version, provenance, lineage |
| `64a8bfa9-7772-45c4-9d1a-9e6290690957` | the display name |

The [`acs-schemas`](https://github.com/AMRC-FactoryPlus/acs-schemas) git
repo is an AMRC-provided **starting library**, not an authoring channel.
It is loaded into the ConfigDB on install and whenever the repo is
pushed, by the schema hook described in [Git Server](git-server.md).
Nothing in the editor ever writes to git.

## Provenance

The schema loader stamps `source` in the metadata entry with the repo it
pulled from, and it re-writes any schema whose stored `source` matches.
An in-place edit of a library schema would therefore be silently
reverted on the next pull.

That gives the editor two rules:

* **Library schema** (`source` is a repo URL): never edited in place.
  Editing forks it into a local copy under a new UUID.
* **Local schema** (`source` is `acs-admin`, or absent): edited according
  to the change classifier below.

A schema with no `source` at all is treated as local. No loader claims
it, so there is nothing to protect it from.

## Forking

Forking a library schema requires a new name, and the copy starts at
version 1 with its own version history.

This prevents a collision. If a site forked `CNC v1` and called the
result `CNC v2`, the day AMRC shipped a real `CNC v2` there would be two
different schemas with the same name and version. Restarting the local
version history makes that impossible. The `derivedFrom` field records
the ancestry that the name no longer carries.

A fork always mints a new UUID. That is what puts a local schema beyond
the reach of both schema loaders, neither of which knows local schemas
exist.

## The composer

The editor works in four kinds of node. The JSON Schema constructs
underneath are never exposed.

| Node | Serialises to |
|---|---|
| Metric | `allOf` of the metric schema and a constraint block |
| Component | `$ref` to another schema |
| Component list | `patternProperties` holding a single `$ref` |
| Group | a nested object with `properties` |

`Schema_UUID` and `Instance_UUID` are owned by the serialiser and shown
read-only. The git loader rejects a schema whose `$id` does not match its
`Schema_UUID`, so the two are always written together.

Anything the composer does not recognise parses to an **opaque** node.
It is displayed read-only and round-trips byte for byte. There is no
schema that fails to load, and opening a hand-written schema cannot
damage it. A raw JSON view is available as an escape hatch.

## Top-level schemas

A schema body may carry a `topLevel` boolean:

```yaml
$id: urn:uuid:4701e66e-0f77-42b0-8ddd-cef60db6ef4a
$schema: https://json-schema.org/draft/2020-12/schema
topLevel: true
title: CNC Machine
```

`true` means a device can be built on this schema directly. `false`
means it is a part used inside another schema, like an axis or a
spindle, and it is hidden when choosing a schema for a device.

The flag lives in the body so it travels with the file in the
`acs-schemas` repo and reaches the ConfigDB through the existing loader.
It is a non-standard keyword, which JSON Schema validators ignore, and
nothing in ACS validates schema bodies.

**Absent is not false.** A schema that says nothing is treated as still
worth showing, and the filter is switched off entirely until at least
one schema in the deployment carries the flag. A library that predates
the flag therefore behaves exactly as it always did.

Reference counting does not replace the flag. It gets most cases right,
but `Robot` is referenced by `Cell` and is still a machine, while
`Bean_Hopper` is referenced by nothing and is not.

Changing the flag is an additive change: it says nothing about the data
a device publishes, so it cannot invalidate a device already using the
schema.

The editor sets it in the schema panel, shown in the detail pane when
nothing in the tree is selected. A newly authored schema starts marked
`true`, since someone sitting down to write one is usually describing a
machine.

## The change classifier

When a local schema is published, its draft is compared against what is
currently published and every difference is classified.

| Change | Class |
|---|---|
| Add a metric, component, component list or group | additive |
| Change documentation, unit, range, historian flag | additive |
| Add an allowed Sparkplug type | additive |
| Drop a `required` entry | additive |
| Remove a node | breaking |
| Rename a node | breaking |
| Remove an allowed Sparkplug type | breaking |
| Point a component at a different schema | breaking |
| Change a component list naming pattern | breaking |
| Add a `required` entry | breaking |
| Change a node from one kind to another | breaking |
| Change anything inside an opaque node | breaking |
| Reorder nodes | not a change |

Reordering carries no meaning in JSON Schema, so it is treated as
presentation.

The classifier deliberately does not diff arbitrary JSON Schema. It
diffs the composer's model, and treats any change touching an opaque
node as breaking without attempting to analyse it.

The outcome is not a choice offered to the author:

* **Every change additive** → the schema is updated in place. Devices
  are unaffected.
* **Any change breaking** → a new schema is published under a new UUID
  with the version incremented. The previous one is left exactly as it
  is, so nothing moves under a running device, and it is marked
  superseded via the `replaces` field.

## Lineage

Two optional fields in the metadata entry:

* `replaces` — the schema this one superseded. Drives the superseded
  badge in the schema list and the "newer version available" flag on a
  device.
* `derivedFrom` — the schema this one was forked from.

Moving a device from one version to the next is a deliberate origin map
edit. The UI flags that a newer version exists; it does not migrate
anything.

## Drafts

An unfinished schema is held in the `Metric schema draft` class
(`962cea2c-1b0c-4397-b01b-03d3eb863fc1`) with its working state in
application `874ae1f3-7335-4a39-ad9e-d729b27a935b`.

Drafts are deliberately not members of the `Metric schema` class. The
schema store, the origin map editor, acs-i3x and the edge agent all
enumerate schemas by membership of that class, so a half-built schema is
invisible to every consumer until it is published.

Publishing a draft creates the real object, writes its three config
entries, and deletes the draft.

Publishing is blocked while the schema references a component that is
still a draft. Such a reference would not resolve for any consumer, and
the origin map editor's reference resolver has no guard against it.

## Who this reaches

Before publishing, the editor reports two separate figures.

* **Configured** — devices whose `DeviceInformation` origin map names
  the schema at any depth, including as a nested component. Complete,
  because the admin UI already holds every device's origin map.
* **Publishing now** — devices the Directory has seen publish the schema
  on their most recent session, via
  `GET /v1/schema/{uuid}/devices`. A subset: a configured device that is
  offline does not appear. Reported as unknown, rather than as zero, if
  the Directory cannot be reached.

It also reports how many other schemas use this one as a component,
which is what makes the reach of a widely referenced schema visible.

## Permissions

Authoring requires ConfigDB write access to the schema applications and
the ability to create objects in the schema classes. The `Administrator`
group already holds the full ConfigDB permission group, so no additional
grant is needed. There is no separate schema-author role.
