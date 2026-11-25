# Edge Scout schemas

This package holds the JSON Schemas for every Edge Scout message, and
the fixtures that every implementation tests against, so the Edge
Agent, the three driver libraries, the drivers and the Admin UI all
agree on the same files. The protocol is in the "Scouting" section of
`acs-edge/docs/edge-split.md`, and the design is in
`docs/architecture/edge-management/edge-scout.md`.

It lives in `lib`, beside the other shared libraries, because the
Docker builds pass `lib` as a build context (`mk/acs.docker.mk`) and
the service-setup image cannot read `acs-edge/`. Services depend on it
with `file:../lib/edge-scout-schemas`.

## Schemas

The schemas are JSON Schema draft 2020-12. Each `$id` is
`urn:edge-scout:<name>`, and the schemas refer to each other by those
ids.

Schema|What it checks
---|---
`common`|Shared definitions: UUIDs, limits, excluded scopes, codes, Sparkplug type names. It checks nothing on its own
`addr`|The `addr` packet, with its optional `features` key
`ncmd`|The JSON value of the `Node Control/Scout` NCMD that the Admin UI sends: `start`, `cancel`, `watch` or `unwatch`
`request`|The Edge Agent's `hello`, `start`, `cancel`, `ack` and `read` on `fpEdge1/<Conn>/scout`
`found`|A driver's `hello`, `accept`, `items`, `progress`, `end` and `values` on `fpEdge1/<Conn>/found/<id>`
`item`|One discovered item, as a driver sends it and as a snapshot stores it
`status`|The ConfigDB entry under the Edge scout status app
`values`|The ConfigDB entry under the Edge scout values app, which holds live values
`snapshot-header`, `snapshot-end`|The first and last lines of a snapshot
`snapshot-line`|Any one line of a snapshot
`merge-fixture`|The format of the files in `fixtures/merge`

`status.schema.json` and `values.schema.json` are self-contained,
because ConfigDB loads each on its own as its app's ConfigSchema.
`acs-service-setup` keeps a copy of each in its `edge.yaml` dump and
has a test that fails when a copy and its file differ.

Some rules can't be written as JSON Schema, so each implementation
checks them in code:

* `options` is at most 8 KiB as JSON.
* Each entry of a `values` message is checked on its own against
  `read_value` in `common`, after the Edge Agent has cut a `value` over
  1024 characters, and entries for addresses the read did not ask for
  are dropped.
* The Edge Agent writes a values entry of at most 64 KiB, dropping the
  largest values first.
* An `items` message is at most 256 KiB, and an item's `detail` at most
  2 KiB as JSON.
* `seq` goes up by 1 for each message of a scan.
* Each entry of an `items` message is checked on its own against
  `item`, after the Edge Agent has truncated over-long strings, so one
  bad item is dropped without losing the batch.
* The Edge Agent writes a status entry of at most 16 KiB. The schema's
  own limits keep the largest possible entry at about 50 KB, under
  ConfigDB's 100kb body limit.
* A snapshot starts with a header, ends with an end line whose `items`
  count matches, and has no repeated `id`. `check_snapshot` checks
  this.

## Fixtures

`fixtures/valid` and `fixtures/invalid` hold one JSON file per case:

```json
{
    "schema": "found",
    "description": "A truncated scan names its reason",
    "data": {"seq": 4, "type": "end", "exhaustive": true, "truncated": true, "reason": null}
}
```

`schema` names the schema the case is for. A case has either `data`, a
single value, or `lines`, a whole snapshot as an array of parsed NDJSON
lines. A valid `lines` case passes `check_snapshot`, and an invalid one
fails it.

`fixtures/merge` holds the branch-scan merge cases. Each file has a
`base` snapshot, a `scan`, and the `expected` new snapshot, or
`{"error": "OPTIONS"}` when the scan names a folder the base does not
have. Compare items by `id`, including each `parent`, because item
order is not significant. `test/reference-merge.js` is a plain
in-memory merge that passes every case, for reference.

## Using it

From Node, with ajv:

```js
import Ajv2020      from "ajv/dist/2020.js";
import add_formats  from "ajv-formats";
import { add_schemas, load_fixtures } from "@amrc-factoryplus/edge-scout-schemas";

const ajv = new Ajv2020();
add_formats(ajv);
const validator = add_schemas(ajv);

const check_item = validator("item");
for (const fx of load_fixtures("valid").filter(f => f.schema == "item"))
    assert.ok(check_item(fx.data));
```

A bundled browser app can import a schema file directly, as
`@amrc-factoryplus/edge-scout-schemas/schemas/item.schema.json`,
because `lib/index.js` reads files with `node:fs`.

Python and Rust read the files from `schemas/` and `fixtures/` by path
and check them with a draft 2020-12 validator, such as `jsonschema` in
Python and the `jsonschema` crate in Rust, in their tests only.

## Tests

```sh
npm install
npm test
```

The tests check that every schema compiles in ajv's strict mode, that
the status schema compiles on its own as ConfigDB loads it, that every
valid fixture passes and every invalid one fails, that every merge
fixture matches the reference merge, and that the largest status entry
the schema allows fits ConfigDB's limit. They need Node 22 or later.
