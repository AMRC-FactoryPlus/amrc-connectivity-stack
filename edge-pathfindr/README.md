# ACS Edge Pathfindr Driver

> The [AMRC Connectivity Stack
(ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is
an open-source implementation of the AMRC's [Factory+
Framework](https://factoryplus.app.amrc.co.uk).

This `edge-pathfindr` service is a driver for the ACS Edge Agent that reads
asset tracking data from the [Pathfindr v5
API](https://portal.pathfindr.co.uk/api-v5-docs/) into the UNS: where an
asset is, what condition it is in, how long it has been running, and the
buildings, cells and zones it moves between.

## Why this is not the REST driver

ACS already ships a generic REST driver, but its schema offers only `None`
or `Basic` authentication. Pathfindr v5 is OAuth2 client credentials, and it
imposes a rate limit that a generic driver has no way to respect.

## The rate limit is the design

Pathfindr permits **120 API calls per minute across the whole tenant**. The
Edge Agent polls per address on a default 10 second interval, which is 6
calls per minute per address, so roughly twenty configured metrics would
exhaust a site's entire budget.

This driver therefore **polls collections, not metrics**. The `/assets`,
`/assets/runtimedata` and `/assets/activitydata` endpoints each return every
asset in one paginated sweep, and every configured metric is served out of
the cached result. API cost is a function of estate size and cache window,
and is independent of how many metrics you configure.

Two consequences worth knowing:

- Most addresses cost nothing beyond the sweep. `location/SN1`,
  `enviro/SN1`, `attrs/SN1` and `assets/SN1` all read from the same cached
  asset collection.
- The history addresses do not. Pathfindr has no bulk history endpoint, so
  each configured history metric is one API call per cache window. Use them
  sparingly on a large estate.

## Configuration

| Property | Type | Required | Default | Description |
|---|---|---|---|---|
| `baseURL` | string | Yes | - | Your tenant, e.g. `https://acme.pathfindr.co.uk` |
| `clientId` | string | Yes | - | OAuth2 client id |
| `clientSecret` | password | Yes | - | OAuth2 client secret |
| `cacheMs` | number | No | `60000` | How long a sweep is reused |
| `rateLimit` | number | No | `110` | Self-imposed calls/minute, below the vendor's 120 |
| `maxPages` | number | No | `20` | Pages per sweep, 100 assets per page |
| `timeout` | number | No | `15000` | Per-request timeout |
| `filterPartNo` | string | No | - | Scope the connection to one part number |
| `filterSerial` | string | No | - | Scope the connection to one serial number |

### Sizing the cache window

A sweep costs one call per page per collection. At 100 assets that is 3
calls; at 1000 it is 30. With the default 60 second window that is 3 or 30
calls a minute against a budget of 120.

If an estate is too large to sweep inside `maxPages`, the driver fetches
what it can and **logs a `TRUNCATED` warning naming how many pages it
skipped**. Assets beyond the cap will not report. It never silently presents
a partial estate as a complete one. The fixes, in order of preference, are
to scope the connection with `filterPartNo`, lengthen `cacheMs`, or raise
`maxPages`.

## Addresses

Addresses name a piece of data, not an endpoint. The driver's own interface
in the Manager builds them for you, so the table below is mostly for people
configuring by CSV or by hand.

| Address | Returns |
|---|---|
| `assets` | Every asset |
| `assets/<serial>` | One asset |
| `runtime`, `runtime/<serial>` | Runtime data: battery, runtime hours |
| `activity`, `activity/<serial>` | Activity durations |
| `location/<serial>` | The asset's `location_data` block |
| `enviro/<serial>` | Latest temperature and humidity |
| `fluid/<serial>` | Latest fluid level reading |
| `attrs/<serial>` | Site-defined attributes, keyed by name |
| `envirohistory/<serial>` | Environmental history (own API call) |
| `impacthistory/<serial>` | Impact history (own API call) |
| `runtimehistory/<serial>` | Runtime history (own API call) |
| `activityhistory/<serial>` | Activity history (own API call) |
| `buildings/<id>` | One building |
| `buildings/<id>/cells`, `buildings/<id>/assets` | Building contents |
| `cells/<id>/zones`, `cells/<id>/assets` | Cell contents |

Serial numbers are the only identifier the driver exposes for assets,
because that is what is printed on the beacon and shown in the portal. Where
an endpoint wants Pathfindr's internal numeric id, the driver resolves it.

### Responses are flattened

Pathfindr speaks JSON:API, so a raw asset arrives as
`{data: {attributes: {serialno: ...}}}`. The driver unwraps this, so paths
read `$.serialno` rather than `$.data.attributes.serialno`. The per-asset
attribute list is additionally re-keyed by name, so a site-defined field is
reachable as `$.attrs['SAP Order Number']`.

Pathfindr is inconsistent about envelopes (collections are wrapped, a single
asset is not, and the documented runtime example has no wrapper at all). The
driver normalises all three.

## The Manager interface

This driver ships a custom per-metric UI, rendered by the Manager in a
sandboxed frame. Pick the data you want and type a serial, and it fills in
the address, JSONPath, Sparkplug type, engineering unit and limits together.

The panel describes the Pathfindr API, not your tenant. It cannot list your
assets, and deliberately has no network access at all. Read the serial off
the beacon or the portal.

Source lives at `ui/metric-panel.html`. It is inlined into
`acs-service-setup/dumps/edge.yaml` by `tools/inline-ui.js`; edit the HTML
and re-run the tool. `test/ui-sync.test.js` fails if the two drift.

## Testing

```sh
npm test        # node --test test/
```

The API tests spin up a fake Pathfindr on localhost that speaks the
documented v5 shapes, including the paging quirk where links drop their
query parameters. Nothing in the test suite touches the real service.
