# Pathfindr asset tracking driver

## Problem

A site has Pathfindr deployed. Beacons on fixtures, tooling and containers,
readers in the cells, and a portal that shows where everything is. It works.

It also has ACS, with machine data flowing into the UNS from a dozen drivers.
That works too.

The two never meet. To answer "was that fixture actually in the cell when the
machine ran?" someone opens the Pathfindr portal in one tab, a Grafana
dashboard in another, and compares timestamps by eye. To answer "which of our
tools has been sitting in the wrong building for a fortnight?" they export a
CSV from the portal by hand. Asset location, temperature, runtime hours and
impact events are all being collected continuously, and none of it is
queryable alongside the production data it needs to be correlated with.

Nothing is broken. The data is simply trapped in a portal, and every question
that spans both systems is answered manually or not at all.

The existing generic REST driver cannot reach it. Its schema offers
`authMethod: None | Basic`, and Pathfindr v5 is OAuth2 client credentials.
There is no token flow, no refresh, no pagination and no awareness of the
vendor's rate limit.

## Appetite

7 days.

Five for the driver, two for its UI panel and for proving the whole thing
against the live tenant. Delivered in one pull request alongside the custom
driver UI mechanism, for 15 days in total.

## Solution

A new `edge-pathfindr` driver built on `PolledDriver`, following the shape of
`edge-tplink-smartplug` and `edge-rtde`, plus a per-metric UI panel that ships
in its driver definition.

### The interesting problem is arithmetic

Pathfindr allows 120 API calls per minute across the whole tenant. The Edge
Agent's default poll interval is 10 seconds and it polls per address. A driver
that maps one address to one HTTP call therefore burns 6 calls per minute per
address, and roughly 20 configured metrics saturate the site's entire budget.
Any naive implementation works in a demo and gets rate-limited in production.

So the driver polls collections, not metrics. The `/assets`,
`/assets/runtimedata` and `/assets/activitydata` endpoints each return every
asset in one paginated sweep. The driver fetches those on a cache window and
serves every configured metric out of the cached collection. Cost becomes a
function of estate size and cache window, and is completely independent of how
many metrics are configured.

### Elements

**1. OAuth2 client credentials with refresh.** Token acquired on connect,
cached, re-acquired on a 401. Connection status maps to the driver library's
`UP` / `CONN` / `AUTH` states so the Manager shows an auth failure as an auth
failure.

**2. Collection-level caching with request coalescing.** One fetch per
collection per cache window. Concurrent polls for the same collection await a
single in-flight promise rather than issuing duplicate requests.

**3. A configurable cache window,** exposed in the connection schema,
defaulting to 60 seconds. Assets are physical things moved by people, so
minute-level resolution matches how fast they actually move and leaves ample
rate-limit headroom. Sites tracking fast-moving stock can tighten it against a
smaller estate.

**4. A sliding-window rate limiter** holding the driver under 120 calls per
minute, so it throttles itself rather than being throttled.

**5. Pagination that rebuilds page URLs.** The vendor documentation states
explicitly that paging links drop query parameters. The driver never follows
`links.next`; it reads `meta.last_page` and constructs each page itself with
its own parameters reapplied.

**6. JSON:API flattening,** so paths read `$.serialno` rather than
`$.data.attributes.serialno`, with the per-asset custom attribute list re-keyed
into an object addressable by name.

**7. A per-metric UI panel** shipped in the driver definition, built on the
custom driver UI mechanism. The operator picks a data type and types a serial.
The panel emits the address, the path, the Sparkplug type, the engineering
unit and sensible limits together, so choosing "Temperature" yields a Float in
degrees Celsius rather than four correlated fields to get right by hand.

**8. Registration** in the five places a stock driver must appear: the UUID
table in `acs-service-setup/lib/uuids.js`, the driver class and definition in
`dumps/edge.yaml`, the image list in the edge-agent Helm chart, the top-level
`Makefile`, and the three build matrices in `publish.yml`.

### The UI panel

```
Per-metric region                      rendered in the sandbox
────────────────────────────────────
  Data          (▾)  Location
                     Temperature
                     Humidity
                     Fluid level
                     Runtime hours
                     Activity
                     Impact
                     Custom attribute
                     Zones in a cell
  Serial        [SN12345]              from the beacon label or the portal
        │
        ▼  panel emits, all at once
  Address  assets
  Path     $.enviro.latest_temperature
  Type     Float
  Unit     °C
  Limits   -20 to 60
```

The panel depends on the custom driver UI mechanism. If that bet is not taken,
the driver still ships and every address works as free text, with the README
carrying what the panel would have carried.

## Rabbit Holes

**Estates too large to sweep.** At 100 assets a full sweep is 3 pages. At 1000
it is 30. At 5000 it is 150, which blows the per-minute budget in a single
sweep. The driver fetches up to a page cap and, when it truncates, logs clearly
that it truncated and by how much. Assets beyond the cap never report, which is
visible and diagnosable. It never silently presents a partial estate as though
it were the whole thing, and it never quietly stretches the cache window to
make the numbers work, because degrading freshness without saying so is its own
kind of lie.

**Serial numbers versus internal IDs.** Endpoints mix a numeric internal ID and
a human serial, and different endpoints prefer different ones. Engineers know
serials, because that is what is printed on the beacon and shown in the portal.
The serial is the only identifier the driver exposes, and it resolves internal
IDs itself where an endpoint demands one.

**Inconsistent response envelopes.** A single asset comes back as a bare
resource object, collections come wrapped in `data`, and the runtime example in
the docs shows no wrapper at all. The driver normalises all three rather than
assuming one.

**A two-year token lifetime.** The documented `expires_in` example is 63115200
seconds. Do not trust it as a contract. Refresh ahead of expiry and treat any
401 as authoritative, re-authenticating once before reporting an auth failure.

**Credentials at rest.** The client secret goes in the connection schema with
`format: password`, matching how the existing REST driver handles its Basic
password. No new secret-handling mechanism.

**Docs versus reality.** Everything above is derived from the published v5
documentation. We have live tenant credentials, so the first day's work is
confirming the response shapes against a real subdomain rather than discovering
divergence in week two.

## No-Gos

- **No write operations.** Trigger alert, bulk alert, periodic alert, launch
  and recycle are all out. They fire irreversible actions on physical assets
  and they solve a different problem from the one above. Worth a separate pitch
  once reads are proven in production.
- **No history backfill.** The history endpoints are exposed as addresses for
  current values. The driver does not walk them to backfill the historian.
- **No topology import.** Buildings, cells and zones are readable as metrics.
  Turning them into ISA-95 nodes in ConfigDB is a different project.
- **No bespoke UNS modelling.** Pathfindr assets are modelled like any other
  asset in the UNS. The driver exposes addresses and the existing Manager and
  ConfigDB machinery decides the shape, exactly as for every other driver.
- **No live API access from the UI panel.** The panel cannot browse the
  tenant's asset list. Serials are typed, read off the beacon or the portal.
