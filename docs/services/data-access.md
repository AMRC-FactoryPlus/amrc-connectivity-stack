# Data Access

The Data Access service lets a client define, find, and download
**datasets** — named collections of Sparkplug telemetry — without
touching Influx directly. It has no UI of its own; a dataset is created
and read entirely through its web API. All permanent state lives in the
ConfigDB (dataset definitions and metadata) and Influx (the underlying
measurements); the service itself is stateless.

## Datasets and structural definitions

A dataset is a ConfigDB object in the `Dataset` class
(`c31d3cbd-01cd-4833-8014-c4512aef1e5c`). What data a dataset actually
contains is defined by exactly one config entry, filed under one of
three **structural applications**. The application the entry is filed
under determines the dataset's structure; the Data Access service
inspects which of the three apps has an entry for a given dataset to
decide how to resolve it.

Structural app | UUID | `config` shape
---|---|---
`Sparkplug source` | `f5d550c4-2831-11f1-b0b0-83fda3035799` | `{ "source": "<Sparkplug Device/Node UUID>" }`
`Union components` | `1c4ca454-de38-44d9-92fb-aa5218bfa257` | `["<dataset UUID>", ...]`
`Session limits` | `8754c000-3778-4ae6-b2b8-bbcd959bb775` | `{ "source": "<dataset UUID>", "from": "<ISO datetime>", "to": "<ISO datetime>" }`

### Sparkplug source

Identifies all measurements published by a given Sparkplug Device or
Node. Measurements are located in Influx by matching the `topLevelInstance`
tag against this UUID.

### Union components

An array of other dataset UUIDs. The union consists of the measurements
of each component combined; components do not have to be Sparkplug
sources, they can be any dataset, including other unions or sessions.
An empty array is a valid `Union components` config — this lets a
work-order-style dataset be created before it has any children.

### Session limits

Selects a time slice from another dataset. `source` can be any dataset,
including another session or union. Both `from` and `to` are required
by the current validation (`session-limits-handler.js`); an open-ended
session — where one bound is omitted — is described in the design but
is not accepted by the current implementation, which rejects a request
missing either field with `422`. Bounds are inclusive. Datetimes must
match `2025-11-13T09:33:18.000Z` exactly (millisecond precision, `Z`
suffix) — `lib/validate.js`'s `valid_datetime` rejects anything else,
including dates that don't round-trip through `Date.parse`/`toISOString`
(e.g. 30 February).

### Structurally invalid datasets

A dataset is **structurally invalid** if it has no structural config
entry, more than one (entries under two or more of the three apps at
once), or its structure cannot be resolved (e.g. a `Session limits` or
`Union components` entry whose `source`/components point at a missing
or itself-invalid dataset, or a circular reference). Invalid datasets
are represented internally with the special UUID
`696396a0-2831-11f1-9b12-33d63b8c5115` in place of a structural app.
They are excluded from `GET v1/metadata` and `GET v1/metadata/:uuid`,
and cannot be downloaded, but they do appear in the structure endpoints
(`GET v1/structure`, `GET v1/structure/:uuid`) so the problem can be
found and fixed. `GET v1/structure/:uuid` on an invalid dataset returns
this special UUID as `structure` and omits `config`.

## ConfigDB objects

All UUIDs below are defined in `lib/constants.js`.

Kind | Name | UUID
---|---|---
Class | `Dataset` | `c31d3cbd-01cd-4833-8014-c4512aef1e5c`
Class | `Measurement` | `cce0ac4e-b5ba-4837-b45d-c74df55aa2d7`
Class | `Published` | `414d2d10-6be8-4c27-8e9f-c716ef5432b9`
Class | `Partial` | `6c583d11-9a88-4bc1-b77c-81b01e9c9827`
Class | `MES dataset` | `586205bf-81c6-4091-9d2c-f3c0465ebdc4`
Class | `Equipment` | `4c93ddc1-e610-4efe-91e3-a355f9ba1a09`
Class | `Work order` | `b416e44c-c57e-4486-9431-64c425f1b2c6`
Class | `Product` | `4a089748-b26b-4f12-8f1a-164bfba97809`
Class | `Operation` | `bd0354eb-b8f7-4bd9-8407-0588e545603c`
Class | `MES` | `2c691583-89fe-4421-bf2c-64e34e663711`
Group | `Dataset group` | `17e37253-8626-4031-b217-28c6a03e91c1`
Group | `Dataset role group` | `56c52f70-0649-4962-8526-9ec9d1c85ca4`
Group | `Structural dataset type` | `70ff7bea-bb2d-48c2-88fd-4f7a79b1aa3c`
Group | `Functional dataset group` | `86e5b048-e956-4820-939e-3abf3eda4e03`
Application | `Dataset definition` | `eae2d4ae-164d-4dc6-b646-7e0320057bd9`
Application | `Dataset metadata` | `e3b9fd2c-9de1-470b-9675-739e2a55b77f`
Application | `Sparkplug source` | `f5d550c4-2831-11f1-b0b0-83fda3035799`
Application | `Union components` | `1c4ca454-de38-44d9-92fb-aa5218bfa257`
Application | `Session limits` | `8754c000-3778-4ae6-b2b8-bbcd959bb775`
Application | `MES identifiers` | `af178f0c-3b1e-44f2-9724-5cf06e8fd056`
Service function | `Data Access service` | `06cee697-29d3-4972-9479-bc392e24946e`
Special | Structurally invalid dataset | `696396a0-2831-11f1-9b12-33d63b8c5115`


## HTTP API (`v1`)

All endpoints are mounted under `/v1` (`lib/api-v1.js`). Dates in
request/response bodies use the ISO format described above.

### `GET v1/metadata`

Returns the JSON array of dataset UUIDs the caller has `Read dataset`
permission on, restricted to structurally valid datasets. **The `from`
and `to` query parameters described in the original design are not
implemented** — the endpoint always returns the full allowed list.

### `GET v1/metadata/:uuid`

Requires `Read dataset` on `:uuid`. Returns `404` if the dataset does
not exist or is structurally invalid. On success, returns:

Property | Type | Meaning
---|---|---
`uuid` | UUID | Dataset UUID
`name` | string | From the dataset's `General Information` config; `"UNKNOWN"` if absent
`from` / `to` | date | Bounds inherited from the `Session limits` in the dataset's structure, recursively; omitted where unbounded
`function` | array | Functional classes the dataset belongs to
`metadata` | object | Config entries keyed by Application UUID, for every application in `Dataset metadata`
`parts` | array | Direct subclasses of this dataset that are themselves Datasets and that the caller has `Read dataset` on


The `function` array returned by `GET v1/metadata/:uuid` is every class
in `Functional dataset group` that the dataset is a member of, read via
`watch_member_members` in `lib/dataflow.js`. Because ConfigDB class
membership is transitive over subclasses, a dataset classified into a
subclass of a functional class (e.g. a hypothetical `MES work order` ⊂
`MES dataset`) is reported as a member of both.


### `POST v1/data/:uuid`

Requires `Read dataset` on `:uuid`. Resolves the dataset's structure
tree recursively into a flat list of `{ device, from, to }` triples
(one per Sparkplug source contributing to the dataset, with time bounds
intersected down through any enclosing sessions), then streams the
result back as a **ZIP archive** (`application/zip`), one CSV per
Sparkplug device named `<device-uuid>.csv`. Each CSV is the raw line
output of an Influx Flux query filtered on `topLevelInstance ==
"<device-uuid>"` and the resolved time range, keeping the columns
`_time`, `_value`, `_measurement`, `device`, `unit` — this is Influx's
own column naming, not the normalised `device`/`metric`/`timestamp`/
`value`/`unit` CSV described in the original design, and metric names
still carry Influx's `:x` datatype suffix.

The request body is optional. If it contains a `measurement` property,
the export is restricted to that one Influx `_measurement` across all
devices; this is not part of the original design but is the only
filtering currently available. An empty or absent body exports
everything in the dataset.

### `GET v1/structure`

Returns the JSON array of dataset UUIDs the caller has `Edit dataset`
permission on. Unlike `v1/metadata`, this includes structurally invalid
datasets.

### `GET v1/structure/:uuid`

Requires `Edit dataset` on `:uuid`; a caller with only `Read dataset`
gets `403`. Returns:

Property | Type | Meaning
---|---|---
`uuid` | UUID | Dataset UUID
`structure` | UUID | The structural application UUID, or the special invalid-dataset UUID
`config` | any | The structural config; absent when the dataset is invalid

### `POST v1/structure`

Body: `{ "structure": "<app UUID>", "config": <structure-specific> }`.
Validates the config shape for the chosen structural app, then requires:

* `Create dataset` on the `structure` app UUID itself, and
* the relevant per-source permission for every source named in `config`
  (see [Permissions](#permissions)).

On success, creates a new `Dataset` object, writes the config entry
under `structure`, records the corresponding subclass relationship(s),
and returns the new dataset's UUID as a JSON string.

### `PUT v1/structure/:uuid`

Body is the same shape as `POST v1/structure`; `uuid` may be included
but must match the path if present. Requires `Edit dataset` on `:uuid`.

* If the dataset is currently **valid**, the request's `structure` must
  match the dataset's current structure — changing from one structural
  type to another via `PUT` returns `409`. The old source's subclass
  relationship(s) are removed before the new one is written.
* If the dataset is currently **invalid**, any existing config entries
  under any of the three structural apps are deleted (404s from a
  missing entry are ignored) and the new config is written; no old
  subclass relationships are touched, since an invalid dataset by
  definition doesn't have a coherent one.

In both cases, only the per-source permission for the new config's
source(s) is checked — `PUT` does **not** re-check `Create dataset` on
the structural app the way `POST` does.

### `GET v1/delete/:uuid`

Deletes a dataset. Note this is a `GET`, not a `DELETE`, request.
Requires `Delete dataset` on `:uuid`. Before deleting the ConfigDB
object, it removes every direct subclass relationship in which this
dataset is the *superclass* (e.g. session/union children recorded
against it). It does **not** clean up relationships in which this
dataset is itself a subclass — e.g. a session's link to its source, or
a union's link to its members — so other structural configs can be left
referencing a UUID that no longer exists. Returns the deleted UUID as a
JSON string, or an empty string if the dataset didn't exist.

## Permissions

Defined in `lib/constants.js` under `Perm`, checked via
`fplus.Auth.check_acl`. As with all Factory+ ACLs, any of these may
also be granted plural, against a group.

Permission | UUID | Targets | Grants
---|---|---|---
`Read dataset` | `ec48462e-37eb-4f56-8efa-83d813e85559` | Dataset | `v1/metadata/:uuid` and `v1/data/:uuid`
`Edit dataset` | `af06b9e5-456a-43e4-b636-5b17de28fc7f` | Dataset | `v1/structure/:uuid` (GET/PUT) and inclusion in the `v1/structure` list
`Create dataset` | `2d666b41-7a0d-4845-ad59-3113f25b469a` | A structural app (`Sparkplug source` / `Union components` / `Session limits`) | Creating a dataset of that structure via `POST v1/structure`
`Delete dataset` | `6f301df8-0ad1-496f-8391-8de92c43ad8e` | Dataset | `GET v1/delete/:uuid`
`Use Sparkplug data` (`UseSparkplug`) | `788b049c-2831-11f1-99fd-2b0bf86d6f77` | Sparkplug Device/Node | Referencing it as a `Sparkplug source`
`Use for session` (`UseForSession`) | `c089b9a9-06cd-4211-94fc-9ad52a759987` | Dataset | Referencing it as a `Session limits` source
`Include in union` (`IncludeInUnion`) | `94d51085-af83-4796-8059-fcd578e3f572` | Dataset | Referencing it as a `Union components` member

Changing a dataset's metadata configs or its functional classification
(e.g. marking it `Published`) is not exposed by this service at all —
it is done directly against the ConfigDB and subject to ordinary
ConfigDB permissions, per the original design.

## Notify interface

`acs-data-access` runs a `notify/v2` WebSocket server (see
[Standard change-notify API](notify-v2.md)) via `lib/notify.js`. The
resources it makes watchable/searchable are registered as:

    WATCH  v2/metadata/
    WATCH  v2/metadata/:uuid
    SEARCH v2/metadata/
    WATCH  v2/structure/
    WATCH  v2/structure/:uuid
    SEARCH v2/structure/

Note the `v2/` prefix on these resource paths — they mirror the plain
HTTP `v1/metadata` and `v1/structure` endpoints (same permission checks,
same response shapes) but are registered under `v2/...`, not `v1/...`,
so a client must subscribe using `v2/metadata/` etc. rather than the
plain-HTTP path. `metadata_search`/`structure_search` build their child
list from `allowed_valid_dataset_uuids`/`allowed_all_dataset_uuids`
respectively, matching the GET-list endpoints' permission and validity
filtering.

## Known gaps

Compared to the original design notes for this service:

* **No date filtering on `GET v1/metadata`.** The `from`/`to` query
  parameters are not read.
* **Dataset download is a ZIP of per-device raw Influx CSV**, not the
  single normalised `device`/`metric`/`timestamp`/`value`/`unit` CSV the
  design describes; Influx's `:x` type suffix on metric names is not
  stripped, and the only filter available is an exact `measurement`
  match (no per-device/schema/metric filtering, no datatype filtering,
  no subsampling).
* **`Session limits` requires both `from` and `to`** — an open-ended
  session (design says "if either is omitted the interval is
  open-ended") is rejected with `422`.
* **Read and metadata access are not split** — a single `Read dataset`
  permission covers both `v1/metadata` and `v1/data`, as in the design,
  but the design's open question about separating them has not been
  revisited.
* **No ownership assignment on creation** — `POST v1/structure` does not
  grant the creating principal ownership of the new dataset.
