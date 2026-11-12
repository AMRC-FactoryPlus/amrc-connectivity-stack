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
six **structural applications**. The application the entry is filed
under determines the dataset's structure; the Data Access service
inspects which of the six apps has an entry for a given dataset to
decide how to resolve it.

Structural app | UUID | `config` shape
---|---|---
`UNS device` | `0d4ac57f-76b5-45c9-9c2d-4b0812be08ff` | `{ "source": "<Device UUID>" }`
`UNS device metrics` | `bd9550fb-ef75-4523-81d6-25dd32c22925` | `{ "source": "<Device UUID>", "metrics": [{ "instance": "<Instance_UUID>", "metric": "<path>" }, ...] }`
`Sparkplug source` (no longer created) | `f5d550c4-2831-11f1-b0b0-83fda3035799` | `{ "source": "<Sparkplug Device/Node UUID>" }`
`Sub-device` (no longer created) | `7f7d40cc-4075-4f06-90cf-aa6261d68f18` | `{ "source": "<Sparkplug Device UUID>", "metrics": [{ "instance": "<Instance_UUID>", "metric": "<path>" }, ...] }`
`Union components` | `1c4ca454-de38-44d9-92fb-aa5218bfa257` | `["<dataset UUID>", ...]`
`Session limits` | `8754c000-3778-4ae6-b2b8-bbcd959bb775` | `{ "source": "<dataset UUID>", "from": "<ISO datetime>", "to": "<ISO datetime>" }`

The four device structures each read one device. `UNS device` and
`UNS device metrics` read the `uns` InfluxDB bucket, which the UNS
historian writes and i3X reads, so a dataset of these kinds holds what
i3X serves for the device. `Sparkplug source` and `Sub-device` read the
`default` bucket, which the Sparkplug historian writes. Data Access no
longer creates them: new device datasets use the UNS kinds. Existing
`Sparkplug source` and `Sub-device` datasets keep working unchanged.
You can read, download, edit and delete them, and use them in unions
and sessions.

### UNS device

Identifies all the data of one device in the UNS. The source must be a
device (a member of the `Device` class) with an ISA-95 placement: only
a placed device is on the UNS, so only a placed device has data in the
`uns` bucket. Data Access finds its points in Influx by the
`topLevelInstance` tag, which holds the device UUID.

A `UNS device` dataset has no data from before the device joined the
UNS. The UNS historian starts writing a device when it first appears
on the UNS, and Data Access does not fall back to the `default` bucket
for earlier windows.

The `uns` bucket holds some metrics the `default` bucket does not:
metrics marked transient, which the Sparkplug historian drops. A
download of a `UNS device` dataset returns everything the bucket holds
for the device, so it can include these. It does not include the birth
metadata (`Instance_UUID` and `Schema_UUID`) or the `Device Control`
metrics, which the UNS historian does not write.

#### Default device datasets

Data Access makes one `UNS device` dataset for every device with an
ISA-95 placement: the device's default dataset. It makes them when it
starts and whenever a device is placed, so a site that upgrades gets
them for its existing devices with nothing to run. A site with no UNS
bucket gets none.

A device needs only one whole-device dataset, so the default one is
the only one:

- **Nobody can make another.** `POST v1/structure` for a `UNS device`
  answers `409 use_default_dataset` with the default dataset's UUID.
  `UNS device` datasets made before this still work, and can still be
  deleted, but cannot be pointed at another device.
- **Nobody can change or delete it.** Its structure, name, tags,
  labels, kind and run details are all fixed: those routes answer
  `409 default_dataset`, whatever the caller holds. Data Access owns
  the dataset. One removed straight from ConfigDB is made again while
  the device is placed.
- **Its name is the device's name.** Data Access renames it when the
  device is renamed.
- **Its UUID follows from the device's.** It is the UUIDv5 of the
  device UUID, as a lower-case string, in the namespace
  `21892bf2-0d9d-4496-a84e-37ff1829b94c`. A client can work it out
  without a lookup. `GET v1/metadata/:uuid/contents` goes the other
  way, from a dataset to its device.
- **Access follows the device.** `Build datasets from device` on the
  device gives `Read dataset`, `Include in union` and `Use for session`
  on its default dataset, and lets the holder read its structure. See
  [Permissions](#permissions).
- **It outlives the placement.** A device that loses its placement
  keeps its default dataset, because unions and sessions may use it.
  A device placed again uses the same one.

Use the default dataset wherever a device goes into a union or a
session. People who share a device then share one dataset for it.

### UNS device metrics

Selects chosen metrics of one device in the UNS. The config and its
rules are the same as for [Sub-device](#sub-device): each entry names a
metric by `instance` and `metric`, or by `{ "path" }` on create and
update, and the choice is limited to metrics in the device's origin map
with `Record_To_Historian` set. The source must be a device with an
ISA-95 placement, as for `UNS device`.

Metric paths stay relative to the device, as for a `Sub-device`. The
`uns` bucket's `path` tag starts with the device's Sparkplug device ID,
for example `Press_1/Axes/X/Position`, or the ID alone for a metric at
the top level of the device. Data Access matches it with a regular
expression that accepts any first segment, followed by the metric's
folder: `^[^/]+/Axes/X/Position$`. The `topLevelInstance` test beside
it picks the device. A change of Sparkplug device ID therefore does not
lose data. ISA-95 moves do not change `path`.

### Sparkplug source

Identifies all measurements published by a given Sparkplug Device or
Node. Measurements are located in Influx by matching the `topLevelInstance`
tag against this UUID. Data Access no longer creates new datasets of
this structure; use `UNS device`.

### Sub-device

Selects specific metrics from one Sparkplug Device. Each entry in
`metrics` names a metric relative to an object in the device's origin
map (its `DeviceInformation` config):

* `instance` is the `Instance_UUID` of the metric's nearest enclosing
  object, or the device UUID for a metric with none.
* `metric` is the path from that object to the metric, without the
  Influx type suffix, e.g. `Position/Actual`. It can include plain
  folders that have no `Instance_UUID` of their own.

`GET v1/sparkplug-sources/:uuid/metrics` lists the references a device
offers. Up to 500 metrics may be listed, with no duplicates.

When creating or updating a dataset, an entry may instead give the full
Sparkplug metric name, as `{ "path": "Axes/X/Position/Actual" }`. The
service looks the path up in the device's current origin map and stores
the equivalent `{ "instance", "metric" }` entry, so the stored config
(and `GET v1/structure/:uuid`) always uses the `instance` form. A path
must name a metric recorded to the historian; anything else is rejected
with `422` and nothing is created. The two forms can be mixed in one
request.

When the dataset is read, each `instance` is looked up in the device's
current origin map, and the metric is located in Influx by the `path`
tag (everything before the last `/` of the full metric name) and
`_measurement`. The historian's `bottomLevelInstance` tag is not used:
it is wrong for many series. Because references hold an
`Instance_UUID`, renaming an object in the origin map does not break
them. A reference whose instance is no longer in the origin map, most
often after the device's schema is changed, reads nothing; it never
widens the read to the whole device.

The admin UI's Datasets pages do not create or edit `Sub-device` or
`UNS device metrics` datasets yet; use the API. Data Access no longer
creates new `Sub-device` datasets; use `UNS device metrics`.

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
missing either field with `422`. The session covers `[from, to)`: it
includes a reading timestamped exactly at `from` and leaves out a
reading timestamped exactly at `to` (see [Time windows](#time-windows)).
Datetimes must match `2025-11-13T09:33:18.000Z` exactly (millisecond
precision, `Z` suffix) — `lib/validate.js`'s `valid_datetime` rejects anything else,
including dates that don't round-trip through `Date.parse`/`toISOString`
(e.g. 30 February).

### Time windows

Every time window in Data Access is start-inclusive and end-exclusive,
written `[from, to)`. A reading timestamped exactly at `from` is in the
window, and a reading timestamped exactly at `to` is not. This applies
to `Session limits`, to the `from` and `to` of a `POST v1/data/:uuid` or
`POST v1/series` request, to the `windows` and `pending` ranges in a
series answer, and to each series bucket.

Two windows that meet, where one stops at the time the next starts,
never both hold the same reading. So a run split into back-to-back
sessions downloads each reading once. This is how the InfluxDB Flux
`range()` function treats its `start` and `stop`, and Data Access passes
`from` and `to` to it unchanged.

When windows nest, for example a session of a session, or a request
window over a session dataset, Data Access takes the later of the two
starts and the earlier of the two stops. The result is still
`[from, to)`.

### Structurally invalid datasets

A dataset is **structurally invalid** if it has no structural config
entry, more than one (entries under two or more of the structural apps
at once), or its structure cannot be resolved (e.g. a `Session limits` or
`Union components` entry whose `source`/components point at a missing
or itself-invalid dataset, or a circular reference). Invalid datasets
are represented internally with the special UUID
`696396a0-2831-11f1-9b12-33d63b8c5115` in place of a structural app.
They are excluded from `GET v1/metadata` and `GET v1/metadata/:uuid`,
and cannot be downloaded, but they do appear in the structure endpoints
(`GET v1/structure`, `GET v1/structure/:uuid`) so the problem can be
found and fixed. `GET v1/structure/:uuid` on an invalid dataset returns
this special UUID as `structure` and `null` as `config`.

## ConfigDB objects

`acs-service-setup` creates these objects; `acs-service-setup/lib/uuids.js`
defines every UUID below. The service's own `lib/constants.js` holds
only the ones the service uses. The five metadata apps marked * are
deliberately not in `App` in `lib/constants.js`: an edit to an invalid
dataset deletes the entries of every app listed there, and these must
survive that. The three the service writes are under `Metadata`
instead. They are members of `Dataset metadata`, so `v1/metadata`
passes them through.

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
Class | `Run` (a subclass of `MES dataset`) | `3c866b35-66a1-4cb8-8db2-dae284883cf8`
Group | `Dataset group` | `17e37253-8626-4031-b217-28c6a03e91c1`
Group | `Dataset role group` | `56c52f70-0649-4962-8526-9ec9d1c85ca4`
Group | `Structural dataset type` | `70ff7bea-bb2d-48c2-88fd-4f7a79b1aa3c`
Group | `Functional dataset group` | `86e5b048-e956-4820-939e-3abf3eda4e03`
Application | `Dataset definition` | `eae2d4ae-164d-4dc6-b646-7e0320057bd9`
Application | `Dataset metadata` | `e3b9fd2c-9de1-470b-9675-739e2a55b77f`
Application | `UNS device` | `0d4ac57f-76b5-45c9-9c2d-4b0812be08ff`
Application | `UNS device metrics` | `bd9550fb-ef75-4523-81d6-25dd32c22925`
Application | `Sparkplug source` | `f5d550c4-2831-11f1-b0b0-83fda3035799`
Application | `Sub-device` | `7f7d40cc-4075-4f06-90cf-aa6261d68f18`
Application | `Union components` | `1c4ca454-de38-44d9-92fb-aa5218bfa257`
Application | `Session limits` | `8754c000-3778-4ae6-b2b8-bbcd959bb775`
Application | `MES identifiers` | `af178f0c-3b1e-44f2-9724-5cf06e8fd056`
Application | `Dataset tags` * | `c95e372e-2fbe-45b9-9937-3235f94e22a3`
Application | `Equipment device labels` * | `dfc3983b-658c-4099-b76a-01ce7c18bde1`
Application | `Run metadata` * | `2b2b4dbc-e0a0-474e-93a8-257bbcbb7f7a`
Application | `Recording in progress` * | `cf3f6103-0f0e-4839-953a-ad2cedc78c30`
Application | `Release policy` * | `cb9b2307-3b82-4ffd-9665-0d214379ac21`
Client role | `Dataset maker` | `b7aa3036-fc1f-4869-b0f5-50f28b028905`
Client role | `Dataset manager` | `4ab8468a-166b-4c01-afa6-7bd558db806b`
Composite permission | `Device data` | `6abc1879-429d-4c0f-a5e4-00a655a09f26`
Service function | `Data Access service` | `06cee697-29d3-4972-9479-bc392e24946e`
Special | Structurally invalid dataset | `696396a0-2831-11f1-9b12-33d63b8c5115`

The Admin UI writes a dataset's name, tags, equipment labels, kind and
run details through the metadata routes below, which check
`Edit dataset`. It writes `Recording in progress` directly to ConfigDB.
`Release policy` holds the terms a `Published` dataset is released
under, and its schema in the dump says what each field means.
Two client roles hold what the Admin UI needs to make datasets and
record runs as the signed-in user:

- `Dataset maker` edits and deletes only the datasets its member
  created, and that includes their metadata. Data Access records the
  creator as each new dataset's owner, and these two grants target
  `Special.Mine`. Datasets created before that change are owned by Data
  Access, so only a `Dataset manager` can edit or delete them.
- `Dataset manager` edits and deletes every dataset.

Both roles read every dataset and any device's data, and can use any
dataset in a union or session. Both can write any equipment's
`Recording in progress` entry: any operator at a machine starts and
stops its recordings. Neither has any other ConfigDB write.

Both roles also hold i3X's `Read i3X objects` on every device. The
Admin UI lists the devices a person can pick for a dataset, and shows
live values, through i3X, so a role member needs this to build
datasets. These are direct grants rather than the `Device data`
composite, so a member never loses them part way through a dump load.

`dumps/data-access.yaml` defines both roles and all their grants.
Service setup loads it on every run, and a dump load replaces every
grant of each principal it names. A grant you add to either role by
hand is removed on the next service-setup run. Give extra access to
the people instead, or to a group of your own.

Each role is defined with `Create dataset` on `Dataset definition`, the
class of every structural app, as a plural grant. That covers the new
`UNS device` kinds. A principal that holds `Create dataset` on single
structural apps, such as `Sparkplug source`, needs new grants on
`UNS device` or `UNS device metrics` to make device datasets.

Both roles are subclasses of `Principal`. Auth only treats subclasses of
`Principal` as groups, so a role declared without it grants nothing to
its members.


## HTTP API (`v1`)

All endpoints are mounted under `/v1` (`lib/api-v1.js`). Dates in
request/response bodies use the ISO format described above.

### `GET v1/metadata`

Returns the JSON array of dataset UUIDs the caller has `Read dataset`
permission on, restricted to structurally valid datasets. That
includes the default dataset of every device the caller holds
`Build datasets from device` on. **The `from`
and `to` query parameters described in the original design are not
implemented** — the endpoint always returns the full allowed list.

#### `include`: metadata for every dataset in one request

`GET v1/metadata?include=<fields>` returns an object for each dataset
in place of its UUID. Each object has `uuid` and the fields you ask
for, with the values `GET v1/metadata/:uuid` gives for them. A client
that needs the names of hundreds of datasets can then ask once, rather
than once per dataset.

`include` is a comma-separated list of these fields, the keys of the
[`GET v1/metadata/:uuid`](#get-v1metadatauuid) answer:

Field | Meaning
---|---
`name` | The dataset's name, `"UNKNOWN"` if it has none
`from` / `to` | The dataset's time window. Each is omitted where the dataset is unbounded
`function` | The functional classes the dataset belongs to. The kind the Admin UI sets (`MES equipment`, `Run`, `MES operation` or `MES product`) is one of these
`metadata` | Config entries keyed by Application UUID, for every application in `Dataset metadata`

`parts` is not available here. Finding a dataset's parts costs a
ConfigDB watch for each dataset, so it comes only from
`GET v1/metadata/:uuid`. You may repeat the parameter
(`include=name&include=from`), and `uuid` is accepted and changes
nothing. An empty `include=` returns objects with `uuid` alone.

The list holds the same datasets as the plain list, checked in the same
way, so it never shows a dataset that `GET v1/metadata/:uuid` would
refuse. The service builds it from the maps it holds in memory, so the
cost does not grow with a call per dataset.

Request:

```http
GET /v1/metadata?include=name,from,to
```

Response:

```json
[
  { "uuid": "5eed0000-0000-4000-8000-000000000001", "name": "Press 3" },
  {
    "uuid": "5eed0000-0000-4000-8000-000000000002",
    "name": "Press 3, first shift",
    "from": "2026-01-01T06:00:00.000Z",
    "to": "2026-01-01T14:00:00.000Z"
  }
]
```

A field the service does not know returns `422`:

```json
{
  "error": "invalid_include",
  "message": "Unknown include field colour. The fields are name, from, to, function, metadata.",
  "unknown": ["colour"],
  "fields": ["name", "from", "to", "function", "metadata"]
}
```

Without `include` the answer is the array of UUIDs, as before.

### Metadata writes: `v1/metadata/:uuid/<field>`

These routes write a dataset's metadata with the service's own rights.
Each requires `Edit dataset` on `:uuid`, returns `404` if `:uuid` is not
a dataset (structurally invalid datasets are included), and returns
`204` on success. ConfigDB checks a config write against the app, for
every object at once, so a caller writing these apps directly could
change them for any dataset, and through `General Information` rename
any object. These routes keep those writes to datasets the caller may
edit.

Every one of these is refused with `409` `default_dataset` for a
[default dataset](#default-device-datasets): Data Access keeps it, and
its name is its device's.

Method and path | Body | Writes
---|---|---
`PUT v1/metadata/:uuid/name` | `{"name": string}` | `name` in `General Information`, keeping its other fields
`PUT v1/metadata/:uuid/tags` | `{"tags": [string]}` | `Dataset tags`; an empty list removes the entry
`PUT v1/metadata/:uuid/labels` | `{"labels": {UUID: string}}` | `Equipment device labels`; an empty object removes the entry
`PUT v1/metadata/:uuid/kind` | `{"kind": UUID \| null}` | Direct membership of one kind class: `MES equipment`, `Run`, `MES operation` or `MES product`. The dataset leaves the others; `null` leaves them all
`PUT v1/metadata/:uuid/run` | object | Replaces `Run metadata`
`PATCH v1/metadata/:uuid/run` | JSON merge patch | Merges into `Run metadata`, so two edits to different fields both stick

A body of the wrong shape returns `422`. The service needs `WriteConfig`
on `Dataset metadata` (plural) and `General Information`, and
`WriteMembers` on `Functional dataset group` (plural).

A read that follows one of these writes returns the new value. See
[Reads after writes](#reads-after-writes).

### `GET v1/metadata/:uuid`

Requires `Read dataset` on `:uuid`. Returns `404` if the dataset does
not exist or is structurally invalid. On success, returns:

Property | Type | Meaning
---|---|---
`uuid` | UUID | Dataset UUID
`name` | string | From the dataset's `General Information` config; `"UNKNOWN"` if absent
`from` / `to` | date | Bounds inherited from the `Session limits` in the dataset's structure, recursively, as a `[from, to)` window; omitted where unbounded
`function` | array | Functional classes the dataset belongs to
`metadata` | object | Config entries keyed by Application UUID, for every application in `Dataset metadata`
`parts` | array | Direct subclasses of this dataset that are themselves Datasets and that the caller has `Read dataset` on


The `function` array returned by `GET v1/metadata/:uuid` is every class
in `Functional dataset group` that the dataset is a member of, read via
`watch_member_members` in `lib/dataflow.js`. Because ConfigDB class
membership is transitive over subclasses, a dataset classified into a
subclass of a functional class (e.g. a hypothetical `MES work order` ⊂
`MES dataset`) is reported as a member of both.

The service holds `name`, `function` and `metadata` in memory and
updates them from ConfigDB notifications. A write made through this
service waits for that update before it answers, so a read sent
straight after it returns the new value. See
[Reads after writes](#reads-after-writes).

### `GET v1/metadata/:uuid/contents`

Lists the devices and metrics that a download of the dataset reads.
Read access to a dataset includes seeing what is in it, so this
requires only `Read dataset` on `:uuid`, with the same checks as
`GET v1/metadata/:uuid`: `403` without it, and `404` if the dataset
does not exist or is structurally invalid. The caller needs no
permission on the devices. Data Access reads their origin maps with its
own rights, as it does for a download.

The dataset is resolved the same way as for `POST v1/data/:uuid`:
`Union components` recursively, `Session limits` down to their source,
to a list of device sources. On success, returns:

Property | Type | Meaning
---|---|---
`uuid` | UUID | Dataset UUID
`from` / `to` | date | As for `GET v1/metadata/:uuid`; omitted where unbounded
`devices` | array | One entry per device and store, in the order the dataset first reaches them

Each device entry has:

Property | Type | Meaning
---|---|---
`uuid` | UUID | Device UUID
`name` | string or `null` | The device's `General Information` name. The edge agent uses it as the Sparkplug device ID, which is what the download's `device` column shows
`store` | string | Where a download reads the device: `uns` (the `uns` bucket) for the `UNS device` kinds, `sparkplug` (the `default` bucket) for `Sparkplug source` and `Sub-device`
`metrics` | array | The metrics a download reads, in the shape `GET v1/sparkplug-sources/:uuid/metrics` returns

A whole-device source (`UNS device` or `Sparkplug source`) gives every
metric in the device's origin map with `Record_To_Historian` set. A
metrics source (`UNS device metrics` or `Sub-device`) gives only its
selected metrics; a selected metric whose object is no longer in the
origin map is left out, as the download leaves it out. A device reached
through several components of one store appears once. If any of them
is a whole-device source, the device lists all its metrics; otherwise
it lists the union of what its metrics sources select. A device reached
through both stores appears once for each, and a download reads it from
both. A device with no origin map has `"metrics": []`.

The list comes from the origin map, not from the bucket. A download of
a `UNS device` dataset can also return transient metrics, which the
list does not show (see [UNS device](#uns-device)).

A metric's `path` is its full Sparkplug metric name. Send it as a
`metrics` selector to `POST v1/data/:uuid` to download only that
metric.

```json
{
  "uuid": "66666666-6666-6666-6666-666666666666",
  "devices": [
    {
      "uuid": "55555555-5555-5555-5555-555555555555",
      "name": "Press_1",
      "store": "uns",
      "metrics": [
        {
          "instance": "1e74e2b2-44a3-44ff-8b2c-8c14a5f15c0b",
          "metric": "Current_AC",
          "path": "Characteristics/Current_AC",
          "type": "FloatLE",
          "unit": "A",
          "documentation": "True RMS current"
        }
      ]
    }
  ]
}
```


### `POST v1/data/:uuid`

Requires `Read dataset` on `:uuid`. Resolves the dataset's structure
tree recursively into a flat list of `{ device, store, from, to }`
sources (one per device structure contributing to the dataset, with
time bounds intersected down through any enclosing sessions), then
streams the result back as a **single CSV file** (`text/csv`, named
`<dataset-uuid>.csv`). Each source is read from its store's bucket,
`uns` or `default`, with an Influx Flux query filtered on
`topLevelInstance == "<device-uuid>"` and the resolved time range, and
all sources are written into the same file. A metrics source
(`UNS device metrics` or `Sub-device`) also filters on its resolved
metrics, as well as on any filter in the request; one with more than
100 metrics is read with several queries. A dataset that reads the
`uns` bucket on a site with no UNS historian gets `503` with
`{"error": "uns_unavailable"}`. The columns are, in this order:

Column | Content
--- | ---
`device` | The Sparkplug device the point came from
`metric` | The metric name, without Influx's `:x` datatype suffix
`timestamp` | ISO 8601 timestamp
`value` | The data value, exactly as Influx returns it, so 64-bit integers keep every digit
`unit` | The engineering unit, if the metric has one
`path` | The full Sparkplug metric name, for example `Axes/X/Position/Actual`; for a metric at the top level of the device, its name
`device_uuid` | The UUID of the device the point came from
`instance_uuid` | The UUID of the instance that owns the metric's folder; for a metric at the top level of the device, the device's UUID
`schema_uuid` | The UUID of that instance's schema
`type` | The datatype the historian stored: `double`, `int`, `uint`, `boolean` or `string`

The columns are the same whichever bucket a row comes from. A row from
the `uns` bucket has no `device` tag: Data Access takes `device` from
the first segment of the row's `path` tag, the Sparkplug device ID, and
`path` from the rest. So a `UNS device` download and a `Sparkplug
source` download of the same device have identical `device`, `metric`,
`path` and `unit` columns.

Two metrics with the same name under different folders have the same
`metric` value but different `path` values. You can send a `path`
value back as a `metrics` selector (below) to export only that metric.
A top-level metric's `path` has no `/`, so as a selector it also
matches metrics with the same name in folders. New columns go at the
end, so clients that read the columns by position keep working.

The body can carry a time window, **`from`** and **`to`**, as ISO 8601
date-times (for example `2026-11-03T09:00:00Z`). They narrow each
source's resolved range and never widen it. The download includes
readings at `from` and leaves out readings at `to`, as for every
[time window](#time-windows). The download needs a start
and an end for every source:

* A dataset bounded by a `Session limits` structure downloads with no
  window in the body.
* A dataset with no time window of its own, such as a `Sparkplug source`
  or a union of them, needs both `from` and `to`. Without them the
  service returns `422`, because the download would read the whole
  history of every device in the dataset.
* A window outside the dataset's own returns `422`, as does a window
  whose `from` is not before its `to`.

A refusal is JSON, `{"error": "<reason>"}`, where the reason says what to
change. Otherwise the body can also contain one of these filters:

* **`metrics`** (array of strings): export only the listed metrics.
  These rules describe how the Sparkplug historian stores points. A
  source in the `uns` bucket matches the same selectors: its `path`
  tag starts with the Sparkplug device ID, which Data Access allows
  for (see [UNS device metrics](#uns-device-metrics)). Each entry is a
  metric selector:
  * An entry that contains `/` is a full Sparkplug metric path, for
    example `Axis/X/Position`. It matches points whose `path` tag is
    `Axis/X` and whose measurement name is `Position` (with any
    datatype suffix). The Sparkplug historian writes the part of the
    metric name before the last `/` as the `path` tag and the part after
    it as the measurement.
  * An entry without `/`, for example `Position`, matches that metric
    name at any path, including metrics at the top level of the
    device.
  * Names never include the `:x` datatype suffix; every suffix is
    matched. An entry that ends in `:i`, `:u`, `:d`, `:b` or `:s` is
    rejected with `422`.
  * A point is exported if it matches any entry.

  The list must have between 1 and 100 entries. Each entry must be a
  non-empty string of at most 512 characters, with no control
  characters and no empty path segment (no leading, trailing or
  doubled `/`). Duplicate entries are ignored.
* **`measurement`** (string, **deprecated**): export only the one Influx
  `_measurement` that exactly equals this value. The value must include
  the datatype suffix, for example `Position:d`. Use `metrics` instead.
  An absent, `null` or empty `measurement` is ignored. Any other
  non-string value is rejected with `422`.

A request that sends both filters, or a filter that breaks these rules,
gets `422` with a JSON body `{ "error": "<reason>" }`. Every filter
value is escaped as a Flux string literal, or for a `uns` source's
path as a regular expression, before it is placed in the query.

### `POST v1/series`

Returns bucketed data for timelines and charts, for a set of devices or
one dataset, over a time window. Per bucket, it returns:

* `count`: the number of data points each device wrote.
* `mean` and `n`: the mean and number of points of chosen metrics.
* `last`: the time of each device's newest data point.

The route reads the raw InfluxDB buckets. A device request reads the
bucket its `store` names. A dataset request reads each source from its
own store's bucket, runs once per store, and merges the results by
device: counts add up, means merge weighted by `n`, and `last` is the
newer time. Counts at `1h` or coarser read the store's coverage
summary instead, when it is ready (see
[Coverage summary](#coverage-summary)).

#### Request

```json
{
  "devices": ["<device UUID>", "<device UUID>"],
  "from": "2026-10-08T00:00:00.000Z",
  "to": "2026-10-09T00:00:00.000Z",
  "every": "15m",
  "count": true,
  "mean": [
    { "device": "<device UUID>", "metric": "Supply/Active_Power_Total" },
    { "device": "<device UUID>", "metric": "Axes/X/Load", "type": "d" }
  ],
  "last": { "lookback": "30d" }
}
```

Field | Rule
---|---
`devices` / `dataset` | Give exactly one. `devices` is a list of device UUIDs (the Sparkplug `topLevelInstance` tag). `dataset` is one dataset UUID.
`store` | Which bucket a device request reads: `sparkplug` (the `default` bucket, the default) or `uns`. Only with `devices`: a dataset's sources say where they are stored. The Admin UI sends `uns`, as new device datasets read the UNS.
`from`, `to` | ISO 8601 date-times, `from` before `to`. Required. `to` may be in the future. The window is `[from, to)`: a reading at `from` counts and a reading at `to` does not (see [Time windows](#time-windows)).
`every` | Bucket size. One of `10s`, `30s`, `1m`, `5m`, `15m`, `30m`, `1h`, `6h`, `1d`, `1w`. Optional.
`points` | Target number of buckets, 1 to 2000, default 300. Used only when `every` is absent: the server picks the smallest step that gives at most `points` buckets.
`count` | `true` to return per-device point counts. Birth metadata (`Schema_UUID` and `Instance_UUID`) does not count.
`mean` | Metrics to return means for. `metric` is the full Sparkplug metric name, for example `Axes/X/Load`. `type` is optional: `d`, `i`, `u`, `b` or `s`. Without `type`, the server reads every numeric type (`d`, `i`, `u`) of the metric and merges them into one series, weighted by `n`. Booleans are read only with `type: "b"`, as 0 and 1: the mean is the share of points that are true. Strings have no mean: `type: "s"` returns empty `points`. In a device request, each `mean` device must also be in `devices`.
`last` | `true`, or `{"lookback": "<n>m|h|d|w"}` (default `30d`, maximum `90d`), to return each device's newest data time. Birth metadata does not count. In a dataset request, only data inside the device's windows counts, and a device whose windows all end before the lookback gets `null`.

Steps up to `6h` align to UTC. `1d` and `1w` buckets start at midnight
and on Monday in Europe/London, so a day is 23 or 25 hours long on the
days the clocks change.

#### Response

```json
{
  "from": "2026-10-08T00:00:00.000Z",
  "to": "2026-10-09T00:00:00.000Z",
  "every": "15m",
  "asOf": "2026-10-08T07:56:10.412Z",
  "source": "raw",
  "devices": {
    "<device UUID>": {
      "windows": [["2026-10-08T00:00:00.000Z", "2026-10-09T00:00:00.000Z"]],
      "count": [[1791417600000, 4537], [1791418500000, 5478]],
      "last": "2026-10-08T07:55:54.302Z"
    }
  },
  "metrics": [
    {
      "device": "<device UUID>",
      "metric": "Supply/Active_Power_Total",
      "type": "d",
      "unit": "kW",
      "points": [[1791417600000, 8.383, 191]]
    }
  ],
  "denied": []
}
```

* Bucket times are epoch milliseconds of the bucket start. A bucket
  holds the readings from its start up to, but not including, the start
  of the next bucket.
* Arrays are sparse. A bucket with no data is absent.
* `points` rows are `[start, mean, n]`. `n` is the number of raw points
  in the bucket. A client can fold a live value `v` into the newest
  bucket with `mean = (mean * n + v) / (n + 1)`.
* `count` is present only when requested. `last` is present only when
  requested, and is `null` when the device has no data in the lookback.
* `windows` is present only for a dataset request. It lists the disjoint
  time ranges, within the request window, in which the device belongs to
  the dataset. Each is a `[from, to)` pair of ISO date-times. Counts and
  means cover only these ranges.
* For a dataset request, `last` is the newest data inside the device's
  dataset windows, within the lookback. It is not limited to the
  request window, so a device that is still in the dataset reports its
  newest data even when `to` is in the past.
* `type` is the requested type, or the type of the newest point. `unit`
  is the `unit` tag of the newest point.
* `asOf` is the server time when the query ran. A bucket that ends after
  `asOf` is partial.
* `source` says where the counts came from: `raw` (the raw bucket),
  `coverage` (the coverage summary) or `mixed` (the summary, plus the
  newest hours, or hours the backfill has not reached, from raw data).
  Means and `last` always come from raw data.
* `pending` is present only when part of the window has no counts yet,
  because the backfill has not reached it and it is too long to count
  from raw data. It lists those ranges as `[from, to)` ISO pairs. A
  client can show "still building history" for them and ask again
  later.
* `denied` lists requested devices the caller may not read.

The response has `Cache-Control: private, max-age=300` when `to` is more
than two buckets before `asOf` and nothing is pending, and `no-store`
otherwise.

#### Permissions

* A dataset request needs `Read dataset` on the dataset. It then covers
  every device of the dataset, within the dataset's windows, as for
  `POST v1/data/:uuid`.
* A device request needs `Build datasets from device` on each device. Root and
  wildcard grants apply. The caller may be a Kerberos principal or a
  JWT caller identified by principal UUID. A principal the Auth service
  has no ACL for is denied every device. Devices without the grant are listed in
  `denied` and left out. The request fails only when every device is
  denied.
* `mean` and `last` entries follow the check of their device.
* In a dataset request, a `mean` metric on a device the dataset reaches
  through a metrics source must be one of that source's metrics, or
  the request gets `422`. If the device is in the dataset more than
  once, the sources that include the metric (whole-device sources
  include every metric) must cover all of the device's windows. Counts
  and `last` are per device, so for a sub-device they cover the whole
  device.

#### Limits and errors

Limit | Value
---|---
Devices per request (or per dataset) | 500
Distinct window sets per dataset request | 100
Queries that read one time window each, per request and per kind (counts, means, last times) | 100
`mean` metrics per request | 50
Buckets per series | 2000
Span for `count` below `1h` | 14 days
Span for `count` at `1h` or coarser | 10 years with the coverage summary ready; 14 days without it
Span for `mean` | 400 days
`last` lookback | 90 days
Time for one request, permission checks and waiting included | 120 seconds (`SERIES_TIMEOUT_MS`)
Time for one query, from when it starts running | 90 seconds (`SERIES_QUERY_TIMEOUT_MS`)
Concurrent queries | 4 (`SERIES_CONCURRENCY`)
Queries waiting to run, across all requests | 400 (`SERIES_MAX_QUEUE`)

The four `SERIES_*` limits are environment variables on the Data
Access deployment. The Helm chart always sets them, from these values,
so a change survives an upgrade. Do not set them with
`kubectl set env`: the next Helm upgrade replaces them.

Helm value | Variable | Default
---|---|---
`dataAccess.series.concurrency` | `SERIES_CONCURRENCY` | `4`
`dataAccess.series.maxQueue` | `SERIES_MAX_QUEUE` | `400`
`dataAccess.series.timeoutMs` | `SERIES_TIMEOUT_MS` | `120000`
`dataAccess.series.queryTimeoutMs` | `SERIES_QUERY_TIMEOUT_MS` | `90000`

Keep `queryTimeoutMs` below `timeoutMs`. The InfluxDB client of the
series route waits 5 seconds longer than `queryTimeoutMs`.

The series route has its own query limiter, so a long `POST v1/data`
export does not delay it. Devices of a dataset that share the same
windows run as one set of queries, so the window-set limit bounds the
queries one request makes.

A dataset device can have several separate time windows, for example
one per session. The route reads each window with its own query, for
counts, means and last times alike. InfluxDB limits time in its storage
engine only through the `range` of a query. A test of `_time` in a
filter runs in Flux, and one query over several windows needs that
test: InfluxDB then reads every raw point between the first window and
the last. The part-hours that a count reads from raw data at the two
edges of a window are read the same way, one query each.

One query per window means more queries, so each request has a budget.
Of each kind (counts, means, last times), a request makes at most 100
queries, or one per window set if it has more window sets than that. A
request that reads two stores gives each store half. When the windows
do not all fit, the window sets with the fewest windows are split
first. The windows left over are read together in one query with a
`_time` filter. That query is correct but slower, because it reads raw
points. No request is refused for having too many windows.

When a request ends early, the server closes its open queries to
InfluxDB, and InfluxDB stops running them. This happens when the
client disconnects, when the request or a query reaches its time
limit, and when one query of the request fails. Queries of that
request that are still waiting for a slot are never sent. A slow
request that a page sends again and again therefore costs InfluxDB at
most its time limit each time, and the queries do not pile up.

Status | When
---|---
`400` | The body is not valid JSON, or not a JSON object.
`403` | No `Read dataset` on the dataset, or every device denied.
`404` | The dataset does not exist or is invalid.
`413` | Too many devices or `mean` metrics, or the body is too large. The body names the limit.
`422` | Both or neither of `devices` and `dataset`; a bad UUID, date, `every` or `store`; `store` with `dataset`; `from` not before `to`; more than 2000 buckets (the body suggests the smallest valid `every`); a span over its limit, including a long count when the coverage summary of a store the dataset reads is not ready; a `mean` device outside the request or the dataset; a dataset with more than 100 distinct window sets across its stores.
`503` | InfluxDB or the Auth service is unreachable, or too many queries are waiting. The last case has `Retry-After: 5`. A request that reads the `uns` bucket on a site with no UNS historian gets `uns_unavailable`.
`500` | InfluxDB failed a query part way through, for a reason other than time. The service log has InfluxDB's message.
`504` | The request or one of its queries took longer than its time limit, or InfluxDB ended a query early because it ran out of time or the query was cancelled.

A query that does not finish never answers `200`. InfluxDB reports a
query that fails after it has begun to answer inside the result, as a
table with the columns `error` and `reference`. The route reads that
table as a failure, so a slow chart shows a timeout and not "no data".

InfluxDB works out each bucket of a `mean` in its storage engine, for
any number of metrics in one request. This needs every part of the
metric filter to be a test that storage can run. A test of a tag
against the empty string is not one, so a metric at the device root is
matched with `not exists r.path`.

The storage engine has no sum of booleans. The mean of a boolean
metric is its number of true points over its number of points, and
storage can work out both: it counts points of any type, and it runs a
test of `_value` against a literal. So a boolean `mean` runs in storage
too, as two counts.

Two cases still read raw points and are slower:

* The windows of a dataset request that do not fit the budget of 100
  queries (see above).
* A `mean` at `1d` or `1w`, and a `count` at those steps that reads raw
  data. Those steps follow the calendar in `Europe/London`, and
  InfluxDB makes windows in storage only in UTC.

`400`, `413`, `422` and `uns_unavailable` responses have a JSON body
with `error` and `message` fields.

The UNS historian creates the `uns` bucket when it starts, which may
be after Data Access. Until the bucket exists, a `uns` query reads as
empty rather than failing the request, and Data Access logs it once.

### `GET v1/coverage/status`

Returns the state of the coverage summary. Any authenticated client may
read `enabled`, `ready`, `stale` and `error`. The other fields describe
data across all devices, such as how far back the raw bucket goes, so
they are included only for a caller with `Build datasets from device`
on every device (a wildcard grant).

The top level describes the summary of the `default` bucket. When the
site has a UNS historian, `uns` holds the state of the `uns` bucket's
summary, in the same shape.

```json
{
  "enabled": true,
  "ready": true,
  "stale": false,
  "error": null,
  "bucket": "acs_coverage",
  "task": {
    "name": "acs-coverage", "id": "<task ID>", "status": "active",
    "last_run": { "status": "success", "scheduledFor": "2026-10-08T09:00:00Z", "finishedAt": "2026-10-08T09:05:01Z" }
  },
  "newestHour": "2026-10-08T08:00:00.000Z",
  "summarisedTo": "2026-10-08T09:00:00.000Z",
  "recountHours": 6,
  "repairDays": 7,
  "backfillEmptyDays": 365,
  "minTime": "2000-01-01T00:00:00.000Z",
  "backfill": {
    "complete": true,
    "backfilledTo": "2023-02-28T00:00:00.000Z",
    "upper": "2026-10-08T23:00:00.000Z",
    "oldestData": "2024-03-01T00:00:00.000Z"
  }
}
```

`backfill.oldestData` is the start of the oldest Europe/London day with
raw data that the backfill has found so far, or `null` if it has found
none. `backfilledTo` is where the summary's coverage ends. It can be up
to about `backfillEmptyDays` below `oldestData`, because the backfill
stops only after that many empty days. Reads older than `backfilledTo`
never come from the summary (see
[How the series route uses it](#how-the-series-route-uses-it)).

`stale` is `true` when the newest summarised hour is more than 3 hours
old. Data Access also logs a warning then. `error` is `null`, or a code
for the last failure: `provisioning_failed`, `backfill_failed` or
`repair_failed`. The Data Access log has the detail.

### `GET v1/sparkplug-sources/:uuid/metrics`

Requires `Build datasets from device` on the device `:uuid`. Returns
the metrics a `UNS device metrics` or `Sub-device` dataset can select,
read from the device's origin map.
Only metrics with `Record_To_Historian` set are listed, since nothing
else reaches Influx. A device with no origin map returns `[]`.

Property | Meaning
---|---
`instance` | `Instance_UUID` of the nearest enclosing object (the device UUID if none); store as the reference's `instance`
`metric` | Path from that object to the metric; store as the reference's `metric`
`path` | Full Sparkplug metric name; can be sent back as a `{ "path" }` entry instead of `instance` + `metric`
`type` | Sparkplug type
`unit` | Engineering unit, if any
`documentation` | Description, if any

The service needs `ReadConfig` on `DeviceInformation`
(`a98ffed5-c613-4e70-bfd3-efeee250ade5`) for this endpoint and to read
metrics datasets; `dumps/data-access.yaml` grants it.

### `GET v1/structure`

Returns the JSON array of dataset UUIDs whose structure the caller may
read: those they hold `Edit dataset` on, and the
[default dataset](#default-device-datasets) of every device they hold
`Build datasets from device` on. Unlike `v1/metadata`, this includes
structurally invalid datasets.

### `GET v1/structure/:uuid`

Requires `Edit dataset` on `:uuid`, or `Build datasets from device` on
the device when `:uuid` is a default dataset; a caller with only
`Read dataset` gets `403`. Returns:

Property | Type | Meaning
---|---|---
`structure` | UUID | The structural application UUID, or the special invalid-dataset UUID
`config` | any | The structural config; `null` when the dataset is invalid

The body does not hold the dataset UUID.

### `POST v1/structure`

Body: `{ "structure": "<app UUID>", "config": <structure-specific> }`.
Validates the config shape for the chosen structural app, then requires:

* `Create dataset` on the `structure` app UUID itself, and
* the relevant per-source permission for every source named in `config`
  (see [Permissions](#permissions)).

On success, creates a new `Dataset` object, writes the config entry
under `structure`, records the corresponding subclass relationship(s),
and returns the new dataset's UUID as a JSON string.

A `UNS device` or `UNS device metrics` source is then checked to be a
device with an ISA-95 placement. These checks run after the permission
check, so a caller without permission learns nothing about the source.
Once those checks pass, a metrics config's `{ "path" }` entries are
converted to `{ "instance", "metric" }` (see
[Sub-device](#sub-device)); a path that does not resolve returns `422`.

The refusals below have a JSON body with a stable `error` code and a
`message`. The service client's `create_dataset` passes the body
through as the error's `body`.

Status | `error` | When
---|---|---
`422` | `structure_retired` | `structure` is `Sparkplug source` or `Sub-device`, which can no longer be created. `use` lists the structures to use instead. Nothing else is checked.
`422` | `device_required` | The source of a UNS kind is not a device, for example a Sparkplug Node. `device` names it.
`422` | `placement_required` | The device has no ISA-95 placement, so it is not on the UNS. `device` names it.
`503` | `uns_unavailable` | The site has no UNS historian, so it has no `uns` bucket.
`409` | `use_default_dataset` | `structure` is `UNS device`. The device already has its [default dataset](#default-device-datasets), and needs no other. `dataset` is its UUID and `device` names the device. It comes after every check above, so the caller is known to hold the permissions and the device to be placed.

For example, a `UNS device metrics` dataset named by path:

```json
{
    "structure": "bd9550fb-ef75-4523-81d6-25dd32c22925",
    "config": {
        "source": "<device UUID>",
        "metrics": [
            { "path": "Axes/X/Position/Actual" },
            { "path": "Switch_Closed" }
        ]
    }
}
```

### `PUT v1/structure/:uuid`

Body is the same shape as `POST v1/structure`; `uuid` may be included
but must match the path if present. Requires `Edit dataset` on `:uuid`.

* If the dataset is currently **valid**, the request's `structure` must
  match the dataset's current structure — changing from one structural
  type to another via `PUT` returns `409`. The old source's subclass
  relationship(s) are removed before the new one is written.
* If the dataset is currently **invalid**, any existing config entries
  under any of the structural apps are deleted (404s from a missing
  entry are ignored) and the new config is written; no old subclass
  relationships are touched, since an invalid dataset by definition
  doesn't have a coherent one.

In both cases, only the per-source permission for the new config's
source(s) is checked, and `PUT` does **not** re-check `Create dataset`
on the structural app the way `POST` does. A UNS kind's new source is
checked as for `POST`, and metrics path entries are converted as for
`POST`, before anything is removed.

Rewriting an invalid dataset makes it anew, so it counts as a create:
rewriting one as a `Sparkplug source` or `Sub-device` gets `422`
`structure_retired`. A valid dataset of those structures can still be
edited. Rewriting one as a `UNS device` gets `409`
`use_default_dataset`. So does changing the device of a `UNS device`
dataset made before default datasets: the other device has its own.

A [default dataset](#default-device-datasets) cannot be edited: the
answer is `409` `default_dataset`.

### `GET v1/delete/:uuid`

Deletes a dataset. Note this is a `GET`, not a `DELETE`, request.
Requires `Delete dataset` on `:uuid`.

A [default dataset](#default-device-datasets) cannot be deleted, by
anyone: the answer is `409` with `"error": "default_dataset"`.

The delete is refused with `409 Conflict` while any other dataset still
points at this one, that is while a `Union components` list contains it
or a `Session limits` config names it as its `source`. The response body
lists the referrers:

```json
{
  "error": "dataset_in_use",
  "dataset": "<uuid>",
  "message": "...",
  "referrers": [ { "dataset": "<uuid>", "structure": "<app uuid>" } ]
}
```

Nothing is written when the delete is refused. Delete from the top of
the graph down: remove the union or session first, then its components.
Invalid datasets are checked too, because they keep their config
documents.

When there are no referrers, the service removes the subclass
relationships this dataset owns in both directions. That covers the
links where the dataset is the superclass (a union's members) and the
links where it is the subclass (a session's link to its source). It then
deletes the ConfigDB object. Returns the deleted UUID as a JSON string,
or an empty string if the dataset didn't exist.

### Reads after writes

The read routes answer from an index the service holds in memory: the
dataset map, the names, the metadata and the functional classes. The
service updates the index from ConfigDB notifications, which arrive a
few milliseconds after a write.

Every route that writes waits until the index holds what it wrote, and
only then answers. A client that reads straight after a write therefore
gets the new value, with no need to wait or to retry. This covers:

Write | Read that returns the new value
---|---
`PUT v1/metadata/:uuid/name` | `name` in `GET v1/metadata/:uuid`
`PUT v1/metadata/:uuid/tags`, `labels`, `run` and `PATCH .../run` | `metadata` in `GET v1/metadata/:uuid`
`PUT v1/metadata/:uuid/kind` | `function` in `GET v1/metadata/:uuid`
`POST v1/structure` | The new dataset in `GET v1/structure/:uuid` and the lists
`PUT v1/structure/:uuid` | The new config in `GET v1/structure/:uuid`, and `from` and `to` in `GET v1/metadata/:uuid`
`GET v1/delete/:uuid` | `404` from the single-dataset reads, and the dataset gone from the lists

The wait changes no status code and no response body. It has a time
limit of 2 seconds (`WRITE_WAIT_MS`, in milliseconds). If the
notification of a write has not arrived by then, the service logs
`A write to ... did not show after 2000 ms` and answers with the
write's normal status, because ConfigDB has accepted the write. A read
can then return the previous value until the notification arrives.

Two things are outside the wait, because they do not come from the
index:

* A write made straight to ConfigDB, not through this service. A read
  returns it once its notification arrives.
* Permissions. A principal's right to a new dataset comes from the Auth
  service, in its own time, and this wait does not cover it.
* `parts`. Each read asks ConfigDB for the dataset's subclasses.

`WRITE_WAIT_MS` is an environment variable of the service. The chart
has no value for it.

## Permissions

Defined in `lib/constants.js` under `Perm`, checked via
`fplus.Auth.check_acl`. As with all Factory+ ACLs, any of these may
also be granted plural, against a group.

Permission | UUID | Targets | Grants
---|---|---|---
`Read dataset` | `ec48462e-37eb-4f56-8efa-83d813e85559` | Dataset | `v1/metadata/:uuid`, `v1/metadata/:uuid/contents`, `v1/data/:uuid` and `v1/series` for the dataset
`Edit dataset` | `af06b9e5-456a-43e4-b636-5b17de28fc7f` | Dataset | `v1/structure/:uuid` (GET/PUT), the `v1/metadata/:uuid/<field>` writes, and inclusion in the `v1/structure` list
`Create dataset` | `2d666b41-7a0d-4845-ad59-3113f25b469a` | A structural app (`UNS device` / `UNS device metrics` / `Union components` / `Session limits`), or `Dataset definition` as a plural grant for all of them | Creating a dataset of that structure via `POST v1/structure`
`Delete dataset` | `6f301df8-0ad1-496f-8391-8de92c43ad8e` | Dataset | `GET v1/delete/:uuid`
`Build datasets from device` (`UseDevice`) | `788b049c-2831-11f1-99fd-2b0bf86d6f77` | Device | Referencing it as the source of a device structure, reading it through `v1/series`, and `v1/sparkplug-sources/:uuid/metrics`
`Use for session` (`UseForSession`) | `c089b9a9-06cd-4211-94fc-9ad52a759987` | Dataset | Referencing it as a `Session limits` source
`Include in union` (`IncludeInUnion`) | `94d51085-af83-4796-8059-fcd578e3f572` | Dataset | Referencing it as a `Union components` member

`Build datasets from device` was called `Use Sparkplug data`
(`UseSparkplug`, still an alias in `lib/constants.js`). It is a Data
Access permission only, and has never given MQTT access.

The **Device data** composite permission
(`6abc1879-429d-4c0f-a5e4-00a655a09f26`) holds i3X's
`Read i3X objects` and `Build datasets from device`. One grant of it on
a device lets a person browse the device in i3X and build datasets from
it. Each service sees its own half. The Admin UI's **Manage access**
dialog gives either half, or both as `Device data`.

On a device's [default dataset](#default-device-datasets),
`Build datasets from device` on the device also counts as
`Read dataset`, `Include in union` and `Use for session`, and lets the
holder read the dataset's structure through `v1/structure`. It never
counts as `Edit dataset` or `Delete dataset`, and it applies to no
other dataset of the device. So one grant of `Device data` on a device
lets a person browse the device in i3X and read and combine its
default dataset.

The metadata routes cover the name, tags, equipment labels, kind and
run details. Any other metadata config, and any other functional
classification (for example marking a dataset `Published`), is written
directly to ConfigDB, subject to ordinary ConfigDB permissions.

## Notify interface

`acs-data-access` runs a `notify/v2` WebSocket server (see
[Standard change-notify API](notify-v2.md)) via `lib/notify.js`, on the
WebSocket path `/notify/v2`. It registers eight resources:

    WATCH  v2/metadata/
    WATCH  v2/metadata/:uuid
    SEARCH v2/metadata/
    WATCH  v2/structure/
    WATCH  v2/structure/:uuid
    SEARCH v2/structure/
    WATCH  v2/union-sources/
    WATCH  v2/session-sources/

The resource paths start with `v2/`, not `v1/`. A client must subscribe
to `v2/metadata/` and so on, not to the plain HTTP path.

Each resource applies the permission rule of the HTTP route with the
same name, including what `Build datasets from device` gives on a
[default dataset](#default-device-datasets). The responses are not the
HTTP responses in every case. No notify resource answers `403` or
`404` for the resource itself, and some bodies differ. The sections
below say what each resource sends.

A subscription gets a `500` and ends if the service loses one of the
ConfigDB or Auth sources it reads. The client can subscribe again.

### Lists

Resource | The datasets it lists
---|---
`WATCH v2/metadata/` | Valid datasets the principal may read, as `GET v1/metadata`
`WATCH v2/structure/` | Datasets whose structure the principal may read, invalid ones included, as `GET v1/structure`
`WATCH v2/union-sources/` | Valid datasets the principal holds `Include in union` on, as `GET v1/union-sources`
`WATCH v2/session-sources/` | Valid datasets the principal holds `Use for session` on, as `GET v1/session-sources`

Each update has status `200` and a JSON array of dataset UUIDs as its
body. A list WATCH sends the whole list when it first answers, and the
whole list again each time a dataset joins or leaves it. It never sends
only the difference. The order of the UUIDs is not specified, and it can
differ from one update to the next and from the HTTP route. A principal
with no rights gets an empty array.

### Searches

`SEARCH v2/metadata/` has one child for each dataset `WATCH v2/metadata/`
lists. `SEARCH v2/structure/` has one child for each dataset
`WATCH v2/structure/` lists. A child is named by the dataset UUID alone.

A search sends one snapshot that holds every child, and after that only
changes. Each change is one child update:

Child status | Meaning
---|---
`201` | The dataset is new to the principal: it was made, it became valid (metadata search only), or the principal was granted it
`200` | The body of a dataset the client already has changed
`404` | The dataset is no longer visible: it was deleted, it became invalid (metadata search only), or the grant was revoked

The snapshot is not followed by an update for each child that repeats
it. The order of the children in a snapshot, and the order of the
updates one change causes for different children, are not specified.
A principal with no rights gets a snapshot with no children.

The body of a metadata search child is the metadata body described
under [single datasets](#single-datasets). The metadata search answers
as soon as the service knows the datasets and the principal's ACL. Just
after the service starts, a body can therefore have the name
`"UNKNOWN"`, no `function`, no `metadata` and an empty `parts`, and a
`200` child update follows when the service has read the missing part.
The parts are read only while a metadata search is open, so the first
search after a quiet time can get an empty `parts` in every body, and
then an update for each dataset that has parts.

`parts` is a set: the order of the UUIDs in it is not specified, and it
can differ between a search, a single watch and the HTTP route.

The body of a structure search child is `{structure, config}`. The
structure search includes
[structurally invalid datasets](#structurally-invalid-datasets). An
invalid dataset is a child with this body:

    { "structure": "696396a0-2831-11f1-9b12-33d63b8c5115", "config": null }

A dataset that becomes invalid while the search is open gets a `200`
child update with that body, and another `200` update with its real
structure when it is valid again.

### Single datasets

`WATCH v2/metadata/:uuid` sends the metadata of one dataset: an object
with the keys `uuid`, `name`, `from`, `to`, `function`, `metadata` and
`parts`, with the meanings `GET v1/metadata/:uuid` gives them. `from`,
`to`, `function` and `metadata` are left out when the dataset has none.
It differs from the HTTP route in these ways:

- It answers at once. When it cannot give a body, it sends status `200`
  with no body. That is the answer for a dataset that does not exist, is
  invalid, or that the principal may not read, where the HTTP route
  answers `404` or `403`. It is also the first answer on a service that
  has just started, before the body is known.
- The first body can have an empty `parts`. The service asks ConfigDB
  for the parts of the one dataset when the watch starts, and does not
  wait for the answer. A dataset that has parts gets a second update
  with them when ConfigDB has answered.
- It sends a new answer each time the body changes. A dataset that is
  deleted, becomes invalid or is no longer readable gets the `200` with
  no body again.
- `name` is `"UNKNOWN"` only when the dataset has no name. An empty
  name is sent as an empty string, where the HTTP route gives
  `"UNKNOWN"`.

`WATCH v2/structure/:uuid` sends `{structure, config}` for a valid
dataset whose structure the principal may read, and again each time it
changes. It sends nothing at all for a dataset that does not exist, is
invalid, or that the principal may not read, and nothing when a dataset
it has answered for goes away. It never sends the invalid marker: use
`WATCH v2/structure/` or the structure search to find invalid datasets.

Because the watch sends nothing when a dataset goes away, the client
keeps the last body the principal was allowed to see. One case is a
[default dataset](#default-device-datasets) whose stored config is
changed in ConfigDB to name another device. A principal who had the
dataset only through the old device gets no message with the new
config, on this watch or on the structure search. The search sends a
`404` child update for the dataset.

A `:uuid` that is not a UUID makes the service close the WebSocket.

A principal that Auth does not know gets the `200` with no body from
`WATCH v2/metadata/:uuid` and no answer from the other seven resources.

## Coverage summary

Timelines show, for each device, how much data arrived in each hour,
day or week. Counting the raw bucket over months is slow, so Data
Access keeps a small summary in its own InfluxDB bucket.

Each raw bucket has its own summary. `acs_coverage`, kept by the task
`acs-coverage`, counts the `default` bucket. When the site has a UNS
historian, `acs_coverage_uns`, kept by the task `acs-coverage-uns`,
counts the `uns` bucket. Both buckets key on the device, so one summary
of both would count each device twice. The two summaries work the same
way and share the settings below; this section describes the first.
The UNS historian creates the `uns` bucket when it starts, so the
second summary waits, retrying, until that bucket exists.

### What it holds

The bucket `acs_coverage` never expires and has 30-day shard groups. It
holds:

Measurement | Field | Tags | One point per
---|---|---|---
`coverage` | `count` (integer) | `topLevelInstance` | device per hour with data
`coverage_daily` | `count` (integer) | `topLevelInstance` | device per Europe/London day with data
`coverage_state` | backfill marker | none | (one point at time 0)

The count rule is the same as `POST v1/series` uses on raw data: every
point of the `value` field counts, except birth metadata
(`Schema_UUID:s` and `Instance_UUID:s`). Each series is counted on its
own and the counts are summed per device. Device names are not stored,
because a renamed device would split its series.

### How it is kept up to date

On every start, Data Access:

1. Creates the bucket if it is missing.
2. Creates the InfluxDB task `acs-coverage` if it is missing, or
   replaces its Flux if it differs from the version this image ships.
   Data Access uses its existing InfluxDB token (`INFLUXDB_TOKEN`), so
   the task runs as the owner of that token. An inactive task is left
   inactive.
3. Starts the backfill, then schedules the daily repair.

A fresh install and an upgrade both get the summary this way, with no
Helm hook. If InfluxDB is unreachable, Data Access retries with backoff
and the series route counts raw data meanwhile.

The task runs every hour at 5 minutes past. Each run recounts the last
6 closed hours (`COVERAGE_RECOUNT_HOURS`) and overwrites them, which
absorbs late data from batching and short store-and-forward. It then
rewrites the daily sums for the days those hours touch. A recount writes
0 for an hour or day the summary holds that no longer has any raw data,
and reads skip zeros.

The **backfill** summarises one Europe/London day at a time, from today
backwards. After each day it writes the marker, so a restart resumes
where it stopped, and a day that failed runs again. If a day is too
large to count in one query, it is counted an hour at a time and then
summed.

The backfill never looks up the oldest raw point, because that query
reads every series over the whole history. Instead, when a day has no
data, it looks for the newest data in the 30 days below that day, with
one `last()` query that InfluxDB runs in its storage engine. If it
finds data, it jumps to that day. If not, it skips the 30 days and
looks in the next 30. It stops when it has seen 365 days in a row with
no data (`COVERAGE_BACKFILL_EMPTY_DAYS`) below the oldest data it has
found, or when it reaches `COVERAGE_BACKFILL_FROM` or
`COVERAGE_MIN_TIME`. So every backfill query covers one day or 30
days, and its cost does not grow with the length of the history.

Raw data below a gap of more than 365 days, such as a few points from a
device with a wrong clock, is not summarised. To summarise it, raise
`COVERAGE_BACKFILL_EMPTY_DAYS`, or set `COVERAGE_BACKFILL_FROM` to a
date below it: the backfill then walks down to that date whatever gaps
it meets.

It runs one query at a time, outside the series route's limiter, and
waits after each day at least as long as that day took (and at least
`COVERAGE_PAUSE_MS`), so it uses no more than half of one query slot.
The time a day takes grows with the number of raw points in that day.
On a test bucket with 7,000 series and a few points per series per
hour, one day took under a second. Dense days take longer. A 30-day
search below an empty day took about half a second.

Each backfill or repair query has a time limit (`COVERAGE_TIMEOUT_MS`,
10 minutes by default). When a query runs over, or Data Access stops,
Data Access closes the connection. InfluxDB is expected to cancel a
query whose client has gone; this has not yet been confirmed on a
cluster. A day counted hour by hour must also finish within three
times `COVERAGE_TIMEOUT_MS` in total, or the backfill gives it up and
tries again later.

If the backfill fails, Data Access logs one line that names the step
that failed (for example `Coverage backfill failed while summarising the
day from 2026-10-01T23:00:00.000Z: query timed out after 600 s;
retrying in 15 min`). It tries again after 15 minutes, then 30
minutes, 1 hour, 2 hours and 4 hours, and then every 6 hours, until a
run succeeds. The marker keeps the progress between tries.

The **daily repair** runs at 03:00 Europe/London. It re-summarises the
last 7 full days (`COVERAGE_REPAIR_DAYS`), to catch store-and-forward data that arrived after the
task's 6-hour recount.

### How the series route uses it

When `count` is requested at `1h`, `6h`, `1d` or `1w` and the summary is
ready:

* `1h` and `6h` read `coverage`. `1d` and `1w` read `coverage_daily` for
  whole days, and `coverage` for part-days at the edges of the window.
* The hours after the newest summarised hour come from raw data.
* Hours older than the backfill marker come from raw data if all the
  raw parts fit within 14 days. Otherwise they are listed in `pending`.
  This also applies after a backfill that stopped on a run of empty
  days: everything below where it stopped (`backfill.backfilledTo`) is
  read from raw data or listed in `pending`, never as zero from the
  summary. Only a backfill that reached `COVERAGE_BACKFILL_FROM` or
  `COVERAGE_MIN_TIME` covers all older time.
* The summary has nothing finer than an hour, so the part-hour at a
  window edge (the request window, or a dataset window) comes from raw
  data. Counts never include time outside the window, and match raw
  counts.

Sub-hour steps always count raw data, with the 14-day limit.

### Settings

All settings are environment variables on the Data Access deployment.
The defaults need no change. The Helm chart sets the main ones from
`dataAccess.coverage` values, so a change survives an upgrade:

Helm value | Variable | Default
---|---|---
`dataAccess.coverage.enabled` | `COVERAGE_ENABLED` | `true`
`dataAccess.coverage.backfill` | `COVERAGE_BACKFILL` | `true`
`dataAccess.coverage.pauseMs` | `COVERAGE_PAUSE_MS` | `1000`
`dataAccess.coverage.backfillEmptyDays` | `COVERAGE_BACKFILL_EMPTY_DAYS` | `365`
`dataAccess.coverage.backfillFrom` | `COVERAGE_BACKFILL_FROM` | (empty)
`dataAccess.coverage.timeoutMs` | `COVERAGE_TIMEOUT_MS` | `600000`
`dataAccess.coverage.repairDays` | `COVERAGE_REPAIR_DAYS` | `7`
`dataAccess.coverage.rebuild` | `COVERAGE_REBUILD` | (empty)

The chart also sets `INFLUXDB_UNS_BUCKET` to `uns`, the bucket the UNS
historian creates, when `historians.uns.enabled` is `true`. Without it
Data Access still starts: it runs no `uns` summary, and the `UNS
device` kinds answer `503` `uns_unavailable`.

For example, to pause the backfill on a busy InfluxDB while keeping
the hourly task and coverage reads:

```yaml
dataAccess:
  coverage:
    backfill: false
```

With the backfill off, the summary is not used until a backfill has
written its marker, so timelines count raw data and long spans show as
`pending`. If a backfill had already started, the summary is used down
to where it got to, and older spans stay `pending` until you turn the
backfill on again. It then resumes where it stopped.

The chart always sets `COVERAGE_ENABLED`, `COVERAGE_BACKFILL`,
`COVERAGE_PAUSE_MS`, `COVERAGE_BACKFILL_EMPTY_DAYS`, `COVERAGE_TIMEOUT_MS`
and `COVERAGE_REPAIR_DAYS`, and sets `COVERAGE_BACKFILL_FROM` and
`COVERAGE_REBUILD` when they are not empty. Do not set these with
`kubectl set env`: the next Helm upgrade replaces them. The chart does
not set `COVERAGE_BUCKET`, `COVERAGE_TASK`, `COVERAGE_RECOUNT_HOURS` or
`COVERAGE_MIN_TIME`; their defaults need no change.

Variable | Default | Meaning
---|---|---
`COVERAGE_ENABLED` | `true` | `false` turns off provisioning, backfill, repair and coverage reads.
`COVERAGE_BUCKET` | `acs_coverage` | The summary bucket. The `uns` summary adds `_uns`.
`COVERAGE_TASK` | `acs-coverage` | The InfluxDB task name. The `uns` summary adds `-uns`.
`COVERAGE_RECOUNT_HOURS` | `6` | Closed hours each task run recounts (1 to 48).
`COVERAGE_BACKFILL` | `true` | `false` skips the backfill. The summary is then not used until a marker exists.
`COVERAGE_BACKFILL_FROM` | (empty) | An ISO date-time the backfill stops at. When set, the backfill walks down to it whatever gaps it meets, and `COVERAGE_BACKFILL_EMPTY_DAYS` does not apply.
`COVERAGE_BACKFILL_EMPTY_DAYS` | `365` | The backfill stops after this many days in a row with no raw data below the oldest data it has found.
`COVERAGE_PAUSE_MS` | `1000` | Minimum pause between backfill and repair days.
`COVERAGE_REPAIR_DAYS` | `7` | Full days the daily repair covers. `0` turns it off.
`COVERAGE_MIN_TIME` | `2000-01-01T00:00:00Z` | Raw points before this are taken to be bad device clocks: the backfill ignores them.
`COVERAGE_TIMEOUT_MS` | `600000` | Time allowed for one backfill or repair query. Data Access then closes the connection, so InfluxDB can cancel the query. A day counted hour by hour has three times this in total.
`COVERAGE_REBUILD` | (empty) | Any new value starts the backfill again from today. Data Access records the value, so the rebuild runs once per value.

### Caveats

* If raw data is deleted from the raw bucket, the summary still counts
  it until those hours are recounted. The task recounts 6 hours and the
  daily repair 7 days. To rebuild from scratch, delete the
  `acs_coverage` bucket and restart Data Access: it creates the bucket
  and backfills again.
* If two Data Access replicas run, both backfill. The writes are
  idempotent, so this costs only duplicate work. If both create the
  task at once, each start keeps the oldest task and deletes the others.
* Task run logs stay in the `_tasks` bucket for 3 days. Use
  `GET v1/coverage/status`, the Data Access log, or `influx task run
  list`, to see failures.

## Known gaps

Compared to the original design notes for this service:

* **No date filtering on `GET v1/metadata`.** The `from`/`to` query
  parameters are not read.
* **Dataset download filtering is limited to metrics.** The download
  can be restricted to a list of metric paths or names, but there is no
  per-device, schema or datatype filtering and no subsampling.
* **`Sub-device` history across renames.** A reference is read using
  the metric's current path, so points recorded before an enclosing
  object was renamed are not returned.
* **`Sub-device` references break on schema changes.** Changing a
  device's schema regenerates its sub-object `Instance_UUID`s, and
  references to the old ones read nothing until the dataset is edited.
* **Overlapping sources are not deduplicated.** A union containing both
  a `Sparkplug source` and a `Sub-device` of the same device returns
  the selected metrics twice. So does a union that reaches one device
  through both stores, for example a `Sparkplug source` and a
  `UNS device` of it.
* **No history before a device joined the UNS.** A `UNS device` or
  `UNS device metrics` dataset reads only the `uns` bucket, and does
  not fall back to the `default` bucket for older windows.
* **`Session limits` requires both `from` and `to`** — an open-ended
  session (design says "if either is omitted the interval is
  open-ended") is rejected with `422`.
* **Read and metadata access are not split** — a single `Read dataset`
  permission covers both `v1/metadata` and `v1/data`, as in the design,
  but the design's open question about separating them has not been
  revisited.
* **No ownership assignment on creation** — `POST v1/structure` does not
  grant the creating principal ownership of the new dataset.
