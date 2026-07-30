# Schema Editor

*Shaped 2026-07-30. Status: pitched, not bet.*

## Problem

A process engineer at a partner site brings a new machine online: a laser
cutter with thirty-odd metrics. There is no laser cutter schema in the AMRC
library.

Today the path runs: describe the machine to an AMRC developer, who
hand-writes YAML, opens a PR against `AMRC-FactoryPlus/acs-schemas`, gets it
reviewed and merged, and cuts a release of the `acs-schemas` image, which the
site picks up on its next upgrade. Days to weeks, for a schema only that site
will ever use. The person who actually knows what the machine measures never
touches it, and every mistake costs another round trip.

The same engineer hits a smaller version of this the following week. The
site's CNCs are covered by the library CNC schema apart from two extra
vibration sensors. There is no way to say "that, plus these two". The options
are to leave the sensors unmodelled, or to start from scratch.

Both cases are the same missing capability: a deployment cannot author its own
schemas. The AMRC library is a shared upstream, and pushing site-specific
machine definitions into it is the wrong shape as well as slow.

ACS had a schema editor once, in `acs-manager`. It was deleted in April 2025
(`d5ab3d90`). It is worth being precise about why it did not survive, because
the failures are instructive:

- **No publish path.** Its terminal action was a file download. Making a
  schema real still meant hand-committing to the GitHub repo. It generated
  JSON and bolted that onto an unchanged manual process.
- **Identity was a URL.** `$id` and every `$ref` were
  `raw.githubusercontent.com` strings, string-replaced throughout. That
  addressing model is now dead; schemas are `urn:uuid:` today.
- **Lossy round-trip.** It classified nodes by sniffing four known shapes.
  Anything else rendered as the literal string `BAD FORMAT`. Opening a
  hand-written schema and saving it was not safe.
- **No versioning and no impact analysis.** Nothing checked whether a change
  was compatible, and nothing could tell you which devices already used the
  schema you were about to alter.

A source comment in it notes that nobody had decided whether schemas came from
GitHub or the ConfigDB. It was abandoned mid-question. That question now has an
answer, which is what makes this shapeable.

## Appetite

Six weeks. One full cycle.

## Solution

### The model

The ConfigDB is where a deployment's schemas live. The `acs-schemas` git repo
is an AMRC-provided starting library, not an authoring channel. Nothing this
project builds ever writes to git.

That gives two rules, and the second falls out of code that already exists:

**Library schemas never change locally.** `acs-git/lib/hooks/schemas.js`
re-writes any schema whose stored `source` matches the repo it pulled from, so
an in-place edit to a library schema is silently reverted on the next pull.
Editing a library schema therefore forks it into a local copy with a new UUID.

**Local schemas follow the change classifier.** Additive edits update in
place. Breaking edits fork to a new UUID and bump the version. The common case
(you forgot a metric) does not churn versions; only genuinely breaking edits do.

### Elements

**1. A Schemas page in acs-admin.** Lists `Class.Schema` objects, split by
provenance, showing where each is used and whether it has been superseded.

**2. A composer with a closed vocabulary.** The author works in five node
types and never sees `allOf`, `$ref` or `patternProperties`:

| Node | Serialises to |
|---|---|
| Metric | `allOf: [{$ref: Common/Metric-v1}, {properties: {...}}]` |
| Component | `$ref: urn:uuid:...` |
| Component list | `patternProperties` keyed on one `$ref` |
| Group | `type: object` with `properties` |
| Opaque | itself, verbatim |

`Schema_UUID` and `Instance_UUID` are owned by the serialiser and are not
author-editable.

**3. A lossless document model.** Anything the composer does not recognise
parses to an Opaque node holding its original JSON, and serialises back
unchanged. This is what makes the raw view safe and it is why there is no
`BAD FORMAT` state.

**4. A change classifier** comparing draft against published body, over the
composer model rather than raw JSON Schema:

| Change | Class |
|---|---|
| Add a Metric, Component, Component list or Group | additive |
| Change documentation, unit, range, historian flag | additive |
| Add an allowed Sparkplug type to a Metric | additive |
| Remove a node | breaking |
| Rename a node | breaking |
| Remove an allowed Sparkplug type | breaking |
| Point a Component at a different schema | breaking |
| Add a property to `required` | breaking |
| Any change touching an Opaque node | breaking |
| Reorder nodes | not a change |

Reordering is presentation. JSON Schema property order carries no meaning and
consumers key by name.

**5. A publish gate** showing the classified changes and the blast radius,
offering update-in-place when everything is additive and forcing a new version
when anything is breaking. Forking is an outcome of the classification, not a
choice the author makes.

**6. Blast radius from data already in the browser.** The admin device store
loads every `Class.Device` with its full `DeviceInformation`, origin map
included, so "which devices use this schema at any depth" is a walk over
in-memory state using the same algorithm as Directory's `find_schemas`. That
covers configured intent. Directory's `GET /v1/schema/:uuid/devices` supplies
the separate "publishing right now" figure. Which schemas reference this one is
a walk of the already-loaded schema store.

**7. Lineage** as two optional fields on the existing `SchemaMetadata` app:
`derivedFrom` (what it was forked from) and `replaces` (the previous version in
its own lineage). These drive the superseded badge and the version flag on the
origin map.

**8. Drafts invisible to everything downstream.** A draft is a separate class
with its body in its own app, so it never appears in the schema store, the
origin map editor, i3x or the edge agent. Publishing creates the real object,
registers it into `Class.Schema`, writes `App.Schema` and `SchemaMetadata`, and
drops the draft.

### Flow

```
Schemas
──────────────────────────────────────────────
  filter: [Library] [Local] [In use] [Drafts]
  rows: name · version · source · used by N · superseded?
  [New schema]   [Open]   [Fork]
        │                    │
        │                    └──────────────┐
        ▼                                   ▼
Schema editor                        Fork notice
──────────────────────────────       ──────────────────────────
  name, version, status              "From the AMRC library.
  structure panel                     Editing makes a local copy."
  detail panel                       name field (required)
  [+ Metric] [+ Component]           [Make a local copy] [Cancel]
  [+ Component list] [+ Group]                │
  [Raw JSON]                                  └──> Schema editor
  [Save draft]     [Publish]
       │               │
       │               ▼
       │        Review changes
       │        ──────────────────────────────────
       │          + Coolant_Temp added
       │          ~ Feed renamed to Feedrate
       │          4 devices use this schema
       │          2 publishing now
       │          ┌ all additive → [Update]
       │          └ any breaking → [Publish as v2]
       │                              │
       ▼                              ▼
  (stays draft)               Schemas, v1 superseded
```

Two panels hang off the editor. Adding a Metric opens a detail panel with
name, Sparkplug type, unit, range, documentation and historian flag. Adding a
Component opens a picker over existing schemas with a single-or-list choice.

One existing surface changes: the device origin map shows a flag when the
device's schema has a successor.

### Copy

The whole feature needs about six strings. They should stay this short.

| Where | String |
|---|---|
| Component picker | A component is another schema used inside this one. |
| Fork notice | This schema comes from the AMRC library. Editing creates a local copy. |
| Publish, additive only | 4 devices use this schema. These changes are safe for them. |
| Publish, breaking | Renaming Feed_Rate breaks the 4 devices using this schema, so this publishes as version 2. |
| Blocked on a draft | Publish Spindle before publishing this schema. |
| Superseded badge | Superseded by CNC Sheffield v2 |

The component picker line is doing real work. "Component" is not ACS
vocabulary today and collides with "component" meaning an ACS service, so the
mapping to "schema" gets stated where the word first appears rather than in a
glossary nobody opens.

## Rabbit holes

**The classifier never touches raw JSON Schema.** Semantic diffing of
arbitrary JSON Schema is unbounded and would eat the cycle. The classifier
diffs the composer model, which is five node types and a fixed table. Anything
involving an Opaque node is classified breaking with no analysis attempted.

**The lossless model is proved on day one.** Parse then serialise every schema
in the AMRC library and assert byte-identical output. This test is cheap,
written against real data, and is the acceptance criterion for the model. If it
cannot be made to pass, that is worth knowing in week one rather than week five.

**Forking a library schema requires a new name, and the version restarts at
1.** Otherwise a site fork of CNC v1 becomes local "CNC v2", and the day AMRC
ships a real CNC v2 the list holds two different things with the same name.
Local versions only advance within their own lineage, so collision is
impossible by construction. The cost is that a fork loses its visual link to
the library schema; `derivedFrom` carries that instead.

**Publish is blocked while any referenced component is still a draft.** The
origin map editor's ref resolver does `found.schema` with no guard, so an
unresolvable reference throws and takes the editor down. The gate names the
offending drafts.

**Forks always mint a new UUID.** This is a hard rule, not a preference. Two
loaders write schemas (the git hook and the install-time `acs-schemas` image)
and neither knows about local ones. A new UUID is what puts a local schema
outside the reach of both.

**The serialiser owns `$id` and `Schema_UUID`.** The git loader throws on
mismatch between them. They are an invariant of the model rather than anything
the UI exposes.

**Sparkplug types come from the schema store**, the way `OriginMapEditor`
already reads `b16275f1-e443-4c41-a482-fcbdfbd20769`. If the type enum is not
reachable there, hardcode it. It is fixed by the Sparkplug B specification and
is not worth a dependency.

## No-gos

- **Deriving schemas from live devices** or from a driver's address space.
  Attractive, and a different feature with a dependency on drivers.
- **Assisted migration between versions.** The editor flags that a newer
  version exists. Moving devices onto it stays a manual origin map edit.
- **Any write to the acs-schemas git repo.** Contributing a local schema back
  to the AMRC library stays a human process.
- **A schema-author role below Administrator.** Administrator already holds
  `ACS.PermGroup.ConfigDB` with a null target, so the permissions needed
  already exist. Finer-grained authoring roles are separate work.
- **Import and export of schemas between deployments.**
- **Validating live device data against its schema.**

## Cut list

In order, if the cycle runs tight:

1. Schema icons. There is a `SchemaIcon` app with FontAwesome paths. Pleasant,
   not needed.
2. Cardinality hints on component lists.
3. The raw JSON view ships read-only. Advanced users still get "show me what
   this produced" and the second write path disappears entirely.

## Appendix: what was verified

Checked against the tree before pitching, so the betting table is not taking
these on trust.

| Claim | Evidence |
|---|---|
| Git loader reverts in-place edits to library schemas | `acs-git/lib/hooks/schemas.js`, `existing.source` check then unconditional `put_config` |
| `$id` must equal `urn:uuid:${Schema_UUID}` | same file, throws `Schema_UUID mismatch` |
| Admin can already write schemas | `acs-service-setup/dumps/admin.yaml`, `ACS.PermGroup.ConfigDB: null` |
| Device origin maps are already in the browser | `acs-admin/src/store/useDeviceStore.js` binds `App.DeviceInformation` over `Class.Device` |
| Schema bodies are already in the browser | `acs-admin/src/store/useSchemaStore.js` binds `App.Schema` over `Class.Schema` |
| Directory can report devices publishing a schema | `acs-directory/lib/api_v1.js:75`, `GET /v1/schema/:schema/devices`; nesting handled by `find_schemas` |
| Refs resolve from ConfigDB, not the network | `OriginMapEditor.vue:299`, custom `urn:uuid` resolver with `http: false` |
| A draft outside `Class.Schema` is invisible downstream | `useStore.ts` enumerates by class membership |
| ConfigDB already refuses writes that invalidate existing configs | `acs-configdb/lib/special.js`, `ConfigSchema.validate` returns 409 |

The last row is precedent rather than a dependency. ACS has already committed
to "validate on write, refuse if existing data would be invalidated" for app
configs, which is the same shape as the publish gate.
