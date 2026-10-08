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

`acs-service-setup` creates these objects; `acs-service-setup/lib/uuids.js`
defines every UUID below. The service's own `lib/constants.js` holds
only the ones the service uses. The four metadata apps marked * are
deliberately not in `lib/constants.js`: an edit to an invalid dataset
deletes the entries of every app listed there, and these must survive
that. They are members of `Dataset metadata`, so `v1/metadata` passes
them through.

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
Application | `Sparkplug source` | `f5d550c4-2831-11f1-b0b0-83fda3035799`
Application | `Union components` | `1c4ca454-de38-44d9-92fb-aa5218bfa257`
Application | `Session limits` | `8754c000-3778-4ae6-b2b8-bbcd959bb775`
Application | `MES identifiers` | `af178f0c-3b1e-44f2-9724-5cf06e8fd056`
Application | `Dataset tags` * | `c95e372e-2fbe-45b9-9937-3235f94e22a3`
Application | `Equipment device labels` * | `dfc3983b-658c-4099-b76a-01ce7c18bde1`
Application | `Run metadata` * | `2b2b4dbc-e0a0-474e-93a8-257bbcbb7f7a`
Application | `Recording in progress` * | `cf3f6103-0f0e-4839-953a-ad2cedc78c30`
Client role | `Dataset maker` | `b7aa3036-fc1f-4869-b0f5-50f28b028905`
Service function | `Data Access service` | `06cee697-29d3-4972-9479-bc392e24946e`
Special | Structurally invalid dataset | `696396a0-2831-11f1-9b12-33d63b8c5115`

The Admin UI writes the four metadata apps. `Dataset maker` holds what
the Admin UI needs to make datasets and record runs as the signed-in
user. The grants apply to every dataset, not only a member's own: a
member can edit any dataset's definition, overwrite any dataset's tags,
run details and recordings, set any dataset's kind, read data from any
device, and rename any object. The role does not include deleting
datasets.


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
result back as a **single CSV file** (`text/csv`, named
`<dataset-uuid>.csv`). Each source is read with an Influx Flux query
filtered on `topLevelInstance == "<device-uuid>"` and the resolved time
range, and all sources are written into the same file. The columns are,
in this order:

Column | Content
--- | ---
`device` | The Sparkplug device the point came from
`metric` | The metric name, without Influx's `:x` datatype suffix
`timestamp` | ISO 8601 timestamp
`value` | The data value
`unit` | The engineering unit, if the metric has one

The CSV has no metric path column. Two metrics with the same name under
different folders appear with the same `metric` value. Use a full-path
`metrics` selector (below) to export only one of them.

The request body is optional. An empty or absent body exports everything
in the dataset. The body can contain one of these filters:

* **`metrics`** (array of strings): export only the listed metrics.
  The service reads one Influx bucket (`INFLUXDB_BUCKET`, by default the
  Sparkplug historian's bucket), so these rules describe how the
  Sparkplug historian stores points. Each entry is a metric selector:
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
value is escaped as a Flux string literal before it is placed in the
query.

### `POST v1/series`

Returns bucketed data for timelines and charts, for a set of devices or
one dataset, over a time window. Per bucket, it returns:

* `count`: the number of data points each device wrote.
* `mean` and `n`: the mean and number of points of chosen metrics.
* `last`: the time of each device's newest data point.

The route reads the raw InfluxDB bucket (`INFLUXDB_BUCKET`). Counts
at `1h` or coarser read the coverage summary instead, when it is ready
(see [Coverage summary](#coverage-summary)).

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
`from`, `to` | ISO 8601 date-times, `from` before `to`. Required. `to` may be in the future.
`every` | Bucket size. One of `10s`, `30s`, `1m`, `5m`, `15m`, `30m`, `1h`, `6h`, `1d`, `1w`. Optional.
`points` | Target number of buckets, 1 to 2000, default 300. Used only when `every` is absent: the server picks the smallest step that gives at most `points` buckets.
`count` | `true` to return per-device point counts. Birth metadata (`Schema_UUID` and `Instance_UUID`) does not count.
`mean` | Metrics to return means for. `metric` is the full Sparkplug metric name, for example `Axes/X/Load`. `type` is optional: `d`, `i`, `u`, `b` or `s`. Without `type`, the server reads every numeric type (`d`, `i`, `u`) of the metric and merges them into one series, weighted by `n`. Booleans are read only with `type: "b"`, as 0 and 1. Strings have no mean: `type: "s"` returns empty `points`. In a device request, each `mean` device must also be in `devices`.
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

* Bucket times are epoch milliseconds of the bucket start.
* Arrays are sparse. A bucket with no data is absent.
* `points` rows are `[start, mean, n]`. `n` is the number of raw points
  in the bucket. A client can fold a live value `v` into the newest
  bucket with `mean = (mean * n + v) / (n + 1)`.
* `count` is present only when requested. `last` is present only when
  requested, and is `null` when the device has no data in the lookback.
* `windows` is present only for a dataset request. It lists the disjoint
  time ranges, within the request window, in which the device belongs to
  the dataset. Counts and means cover only these ranges.
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
  from raw data. It lists those ranges as `[from, to]` ISO pairs. A
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
* A device request needs `Use Sparkplug data` on each device. Root and
  wildcard grants apply. The caller may be a Kerberos principal or a
  JWT caller identified by principal UUID. A principal the Auth service
  has no ACL for is denied every device. Devices without the grant are listed in
  `denied` and left out. The request fails only when every device is
  denied.
* `mean` and `last` entries follow the check of their device.

#### Limits and errors

Limit | Value
---|---
Devices per request (or per dataset) | 500
Distinct window sets per dataset request | 100
`mean` metrics per request | 50
Buckets per series | 2000
Span for `count` below `1h` | 14 days
Span for `count` at `1h` or coarser | 10 years with the coverage summary ready; 14 days without it
Span for `mean` | 400 days
`last` lookback | 90 days
Time for one request, permission checks and waiting included | 60 seconds (`SERIES_TIMEOUT_MS`)
Time for one query, from when it starts running | 30 seconds (`SERIES_QUERY_TIMEOUT_MS`)
Concurrent queries | 4 (`SERIES_CONCURRENCY`)
Queries waiting to run, across all requests | 400 (`SERIES_MAX_QUEUE`)

The series route has its own query limiter, so a long `POST v1/data`
export does not delay it. Devices of a dataset that share the same
windows run as one set of queries, so the window-set limit bounds the
queries one request makes. The server cancels the queries when the
client disconnects.

Status | When
---|---
`400` | The body is not valid JSON, or not a JSON object.
`403` | No `Read dataset` on the dataset, or every device denied.
`404` | The dataset does not exist or is invalid.
`413` | Too many devices or `mean` metrics, or the body is too large. The body names the limit.
`422` | Both or neither of `devices` and `dataset`; a bad UUID, date or `every`; `from` not before `to`; more than 2000 buckets (the body suggests the smallest valid `every`); a span over its limit; a `mean` device outside the request or the dataset; a dataset with more than 100 distinct window sets.
`503` | InfluxDB or the Auth service is unreachable, or too many queries are waiting. The last case has `Retry-After: 5`.
`504` | The request or one of its queries took longer than its time limit.

`400`, `413` and `422` responses have a JSON body with `error` and
`message` fields.

### `GET v1/coverage/status`

Returns the state of the coverage summary. Any authenticated client may
read `enabled`, `ready`, `stale` and `error`. The other fields describe
data across all devices, such as how far back the raw bucket goes, so
they are included only for a caller with `Use Sparkplug data` on every
device (a wildcard grant).

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
none. `backfilledTo` can be up to `backfillEmptyDays` below it, because
the backfill stops only after that many empty days.

`stale` is `true` when the newest summarised hour is more than 3 hours
old. Data Access also logs a warning then. `error` is `null`, or a code
for the last failure: `provisioning_failed`, `backfill_failed` or
`repair_failed`. The Data Access log has the detail.

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
Requires `Delete dataset` on `:uuid`.

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

## Permissions

Defined in `lib/constants.js` under `Perm`, checked via
`fplus.Auth.check_acl`. As with all Factory+ ACLs, any of these may
also be granted plural, against a group.

Permission | UUID | Targets | Grants
---|---|---|---
`Read dataset` | `ec48462e-37eb-4f56-8efa-83d813e85559` | Dataset | `v1/metadata/:uuid`, `v1/data/:uuid` and `v1/series` for the dataset
`Edit dataset` | `af06b9e5-456a-43e4-b636-5b17de28fc7f` | Dataset | `v1/structure/:uuid` (GET/PUT) and inclusion in the `v1/structure` list
`Create dataset` | `2d666b41-7a0d-4845-ad59-3113f25b469a` | A structural app (`Sparkplug source` / `Union components` / `Session limits`) | Creating a dataset of that structure via `POST v1/structure`
`Delete dataset` | `6f301df8-0ad1-496f-8391-8de92c43ad8e` | Dataset | `GET v1/delete/:uuid`
`Use Sparkplug data` (`UseSparkplug`) | `788b049c-2831-11f1-99fd-2b0bf86d6f77` | Sparkplug Device/Node | Referencing it as a `Sparkplug source`, and reading it through `v1/series`
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

## Coverage summary

Timelines show, for each device, how much data arrived in each hour,
day or week. Counting the raw bucket over months is slow, so Data
Access keeps a small summary in its own InfluxDB bucket.

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
In production-sized history, expect about a second of query time per
day of history.

Each backfill or repair query has a time limit (`COVERAGE_TIMEOUT_MS`,
10 minutes by default). A query that runs over is cancelled: Data
Access closes the connection, and InfluxDB stops the query. Stopping
Data Access cancels its query in the same way.

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

For example, to pause the backfill on a busy InfluxDB while keeping
the hourly task and coverage reads:

```yaml
dataAccess:
  coverage:
    backfill: false
```

Do not set these variables with `kubectl set env`: the next Helm
upgrade replaces them.

Variable | Default | Meaning
---|---|---
`COVERAGE_ENABLED` | `true` | `false` turns off provisioning, backfill, repair and coverage reads.
`COVERAGE_BUCKET` | `acs_coverage` | The summary bucket.
`COVERAGE_TASK` | `acs-coverage` | The InfluxDB task name.
`COVERAGE_RECOUNT_HOURS` | `6` | Closed hours each task run recounts (1 to 48).
`COVERAGE_BACKFILL` | `true` | `false` skips the backfill. The summary is then not used until a marker exists.
`COVERAGE_BACKFILL_FROM` | (empty) | An ISO date-time the backfill stops at. When set, the backfill walks down to it whatever gaps it meets, and `COVERAGE_BACKFILL_EMPTY_DAYS` does not apply.
`COVERAGE_BACKFILL_EMPTY_DAYS` | `365` | The backfill stops after this many days in a row with no raw data below the oldest data it has found.
`COVERAGE_PAUSE_MS` | `1000` | Minimum pause between backfill and repair days.
`COVERAGE_REPAIR_DAYS` | `7` | Full days the daily repair covers. `0` turns it off.
`COVERAGE_MIN_TIME` | `2000-01-01T00:00:00Z` | Raw points before this are taken to be bad device clocks: the backfill ignores them.
`COVERAGE_TIMEOUT_MS` | `600000` | Time allowed for one backfill or repair query. A query that runs over is cancelled in InfluxDB too.
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
  per-device, schema or datatype filtering and no subsampling. The CSV
  has no metric path column.
* **`Session limits` requires both `from` and `to`** — an open-ended
  session (design says "if either is omitted the interval is
  open-ended") is rejected with `422`.
* **Read and metadata access are not split** — a single `Read dataset`
  permission covers both `v1/metadata` and `v1/data`, as in the design,
  but the design's open question about separating them has not been
  revisited.
* **No ownership assignment on creation** — `POST v1/structure` does not
  grant the creating principal ownership of the new dataset.
