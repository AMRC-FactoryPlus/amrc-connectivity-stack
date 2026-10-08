# Release Notes

This documents important user-visible changes to ACS, in reverse
chronological order.

## Current development

These changes have not been released yet, but are likely to appear in
the next release.

These changes are aimed at installations with tens of thousands of
devices. Most of them are internal, but a few need you to act during
the upgrade, and some change what clients see.

### Upgrading: i3X needs a volume, and answers 503 while it first syncs

i3X now keeps its namespace and the last value of each metric in a
SQLite database at `/data/i3x.db`, instead of on the JavaScript heap.
By default the chart puts the database on a new PersistentVolumeClaim,
`i3x-data`, of **10Gi** (ReadWriteOnce):

```yaml
i3x:
  persistence:
    enabled: true
    size: 10Gi
    storageClass: ""
```

An empty `storageClass` uses the cluster's default StorageClass. If
your cluster has no default, set `storageClass`, or the claim is never
bound and the i3X pod stays Pending. At 74,000 devices the database is
about 2 GB, and its write-ahead log can reach about 1.5 GB more during
a burst of new UNS metrics. With `persistence.enabled: false` the
database goes on an `emptyDir`, and every start syncs from scratch.

The first start after the upgrade builds the database from ConfigDB.
So does a start after the volume is lost, or after a change to the
database schema or the i3X namespace.
The pod reports ready at once, because its probes only check that the
port is open, but the API answers **503** until the sync completes. In
testing this took **about 6 minutes at 74,000 devices**. Later restarts
serve the stored tree at once and fetch only the configs that changed.
If a few configs keep failing to load, i3X serves the tree without them
after 2 minutes and keeps retrying (the `I3X_READY_GRACE_MS`
environment variable, which the chart does not set).

Upgrade ConfigDB and i3X together. The new i3X follows ConfigDB through
a new ETag search that older ConfigDB versions do not have. Against an
older ConfigDB, i3X retries every 10 seconds and, on an empty database,
never becomes ready. This matters only if you pin image tags for the
two services separately.

With the volume enabled, the i3X Deployment uses `RollingUpdate` with
`maxSurge: 0` and `maxUnavailable: 1`. Kubernetes stops the old pod
before it creates the new one, so **i3X is briefly unavailable on every
upgrade or restart**.

The release candidates v6.11.0-rc.5 and rc.6 set this Deployment to
`strategy: Recreate`. Under Helm 4, which uses server-side apply, that
upgrade fails with:

```
Deployment.apps "i3x" is invalid: spec.strategy.rollingUpdate: Forbidden: may not be specified when strategy `type` is 'Recreate'
```

If you patched the i3X Deployment to `Recreate` by hand to get past
that error, your next Helm 4 upgrade reports a conflict with the
`kubectl-patch` field manager. Run `helm upgrade` with
`--force-conflicts` once. Later upgrades need no flag. An installation
that was never patched by hand needs nothing.

Kubernetes does not wait for the old pod to finish terminating, so the
old and new pods can have the database open together for a few
seconds. The new pod waits for the old pod's locks when it opens the
database.

### Upgrading: the MQTT broker's heap is capped at 512 MB

The HiveMQ broker ran with no JVM heap limit. The JVM then sizes its
heap from the node's memory (25% by default, so 4 GB on a 16 GB node)
and rarely gives memory back, so the broker kept whatever peak it had
seen. The broker now runs with **`-Xmx512m`**, from a new
`mqtt.javaOpts` value. With this heap the broker ran at about 800 MB
resident under a fleet of about 44,000 Sparkplug devices.

```yaml
mqtt:
  javaOpts: "-Xmx512m"
  resources: {}
```

Set `mqtt.javaOpts: ""` to return to the JVM default. `mqtt.resources`
is new and empty by default. If you set a memory limit, allow about
300 MB above the heap limit for non-heap memory.

### Set memory for ConfigDB and i3X

ConfigDB and i3X set no resources, so they run as BestEffort pods: the
first the kernel kills when a node runs short of memory. The chart now
has `configdb.resources` and `i3x.resources`. Both are empty by
default, which renders the same manifests as before. We recommend you
set them. The examples in `values.yaml` are:

```yaml
configdb:
  resources:
    requests:
      memory: 1Gi
    limits:
      memory: 4Gi
i3x:
  resources:
    requests:
      memory: 512Mi
    limits:
      memory: 1Gi
```

With about 40,000 devices, ConfigDB used about 0.9 GiB at rest and
1.5 GiB while i3X ran its first sync. A 2 GiB limit was too low: its
heap ran out while clients reconnected. i3X used about 370 MiB during
the same sync, with MCP off and the default heap cap. A limit that is
too low turns memory pressure into a restart loop, so size it above the
normal working set.

### The i3X MCP endpoint is off by default

The MCP endpoint (`/mcp`) and the search index behind it cost about
**47 KB of memory per device**, so they are now off by default. While
they are off, `/mcp` answers 404. Set `i3x.mcp.enabled: true` to turn
them back on.

`i3x.maxHeapMB` (default **384**) caps the i3X JavaScript heap with
`--max-old-space-size`. Set it to 0 for no cap. It applies only while
MCP is off, because the search index needs several GB at fleet scale.
If you enable MCP, raise the i3X memory limit to several GiB.

### i3X value reads honour maxDepth

`GET /objects/:elementId/value` now takes a `maxDepth` query parameter,
which defaults to 1, as `POST /objects/value` already did. Before, a
composition answered from i3X's cache returned its whole subtree
whatever was asked for, while one read from InfluxDB stopped at
`maxDepth`. Both now return leaves to depth 1 by default. **Clients
that want the whole subtree must send `maxDepth: 0`**.

Both endpoints now refuse a `maxDepth` that is not a non-negative
integer with a 400. When the server sets a depth cap
(`I3X_MAX_DEPTH_CAP`), `maxDepth: 0` is clamped to the cap and answered
with a 206, as a request deeper than the cap already was.

The Explorer in the admin UI shows a composition's current value as a
tree of names, with nested compositions expanded. It reads 3 levels at
once and loads deeper ones when you expand them.

### Other changes to the i3X API

- `GET /objects`, related objects and composition values are streamed
  as they are read, so `GET /objects` has no `Content-Length`. Its weak
  ETag comes from the tree's revision, and a matching `If-None-Match`
  gets a 304.
- A client that reads nothing from a streamed response for 60 seconds
  is disconnected (`I3X_STREAM_IDLE_MS`).
- Each subscription's queue holds at most 10,000 updates
  (`I3X_SUBSCRIPTION_QUEUE_MAX`). When it is full, the oldest updates
  are dropped.
- UNS messages for devices that are not in ConfigDB are ignored.

The environment variables in this list are not set by the chart.

### i3X keeps current values across restarts

i3X keeps the values it receives from the UNS in its database. It also
keeps values it reads from InfluxDB, but now only for devices that
publish to the UNS: those whose `Device_Information` has an
`ISA95_Hierarchy` with at least an Enterprise. A device without one is read from
InfluxDB every time, as it was on v6.10.x.

After a restart or an MQTT reconnect, i3X catches its stored values up
from InfluxDB instead of reading every value again. It waits `marginMs`
after connecting, so the historians can write what was published just
before. It then reads the points written since the values were last
current. Reads fall back to InfluxDB until
the catch-up finishes. While connected, it also refreshes the values it
keeps from InfluxDB every `refreshMs`.

```yaml
i3x:
  catchUp:
    marginMs: 60000
    maxGapMs: 86400000
    refreshMs: 300000
```

Keep `marginMs` above the historians' `flushInterval`, and keep
`maxGapMs` (at most 30 days) below the InfluxDB bucket's retention.
i3X clears its values and reads them again instead of catching up in
some cases. The main ones are:

- It has no record of when the values were last current. This happens
  on **the first start of this version**.
- The gap is longer than `maxGapMs` (24 hours by default).
- The catch-up query still fails after retries at 5, 15 and 45
  seconds.
- More than 1,000,000 stored values changed during the gap.
- The record of when the values were last current is in the future,
  because the clock has gone back.

### ConfigDB delivers class changes up to a second later

During a bulk device import, ConfigDB looked up every watched class's
members again on every object create. On one cluster importing about
16 devices a second this kept PostgreSQL at about 0.9 of a core. Each
class lookup now runs at most once per `configdb.classLookupInterval`,
in ms:

```yaml
configdb:
  classLookupInterval: 1000
```

The first change after a quiet period is delivered at once, and the
last change of a burst is always delivered. A change that follows
another within the interval reaches watchers up to a second later. For
example, a new principal's ACL can take up to a second to appear. If
Keycloak looks the principal up in that second, its Factory+ SPI caches
the empty result for its cache TTL (60 seconds by default).
Set `classLookupInterval: 0` to look up on every change, as before.

### Slow notify clients no longer grow the server's memory

A client that read its notify WebSocket slowly made ConfigDB hold every
update for it in memory. During one bulk import ConfigDB grew from 0.66
GiB to 3.6 GiB this way. Updates now go straight to the socket only
while less than **8 MiB** is waiting to be sent. After that, the server
holds back later updates and keeps only the latest state of each
subscription (and of each child of a search). A slow client can
therefore skip intermediate states, but it always ends with the
server's current state. Every service that serves notify uses this.
Set the limit in bytes with the `NOTIFY_MAX_BUFFER` environment
variable, which the chart does not set.

### The monitor no longer rebirths quiet Nodes

The monitor rebirthed any Node that published nothing for its interval
(3 minutes by default), and repeated that every interval. A Node whose
Devices never change publishes nothing after its births, so it was
rebirthed every few minutes, indefinitely. The monitor now treats a
Node as alive from its NBIRTH until its NDEATH:

- A connected Node that publishes nothing is not rebirthed and not
  marked offline.
- When the monitor starts, or its own MQTT connection comes back, it
  rebirths each Node it has not seen birth within one interval. If a
  Node does not answer, the monitor rebirths it after about 1, 3, 7 and
  15 intervals, then once every 8 intervals.
- The offline alert still fires after 3 intervals with nothing from the
  Node, counted from the monitor's start, the return of its own MQTT
  connection, or the Node's NDEATH. Any packet from the Node clears it.
- The monitor no longer detects an Edge Agent that keeps its MQTT
  session open but has hung.

The monitor and the Sparkplug app library (used by the admin UI and
service-client's ConfigDB watcher) now log MQTT errors such as a reset
connection. Before, the monitor could crash when the broker
restarted.

The edge monitor no longer sends an agent a config reload on every
birth when its cached config revision is stale. It now checks the live
revision with ConfigDB first.

### The Directory announces only real changes

Every device birth published `Last_Changed` notices for the device and
its address, even when nothing had changed. A rebirth of one node with
about 7,300 devices published about 7,300 of them. The Directory now
publishes these notices for a birth only when the device is new, has
moved, its address has a different device, or it was offline. Deaths
and schema changes are announced as before.

### service-setup no longer loops when a restart is slow

After it runs, service-setup restarts the MQTT broker and Keycloak and
waited 120 seconds for each rollout. A slower rollout failed the Job,
and each retry restarted both again. On a busy node this restarted the
broker every few minutes, disconnecting every client. It now waits up
to 600 seconds, and if the rollout has still not finished, it logs this
and leaves the rollout to the Deployment controller.

### The UNS value is the newest sample in a batch

When a Sparkplug payload carries several samples of one metric, the
UNS ingester now publishes the newest as the metric's `value` and puts
the older ones in `batch`. Before, `value` was the oldest.

### Historians and the UNS ingester restart when they stop receiving data

The Sparkplug historian, the UNS historian and the UNS ingester could
keep running, and report healthy, with no working MQTT connection or
subscription. The historians logged `Flushed 0 points` and wrote
nothing until someone restarted them. Each service now exits, so
Kubernetes restarts it, in these cases:

* Data has started to flow, and then no message arrives on its
  subscription for `stallTimeout` seconds (default 600). The Sparkplug
  historian and the UNS ingester count any Sparkplug message,
  including births, deaths and STATE. The UNS historian counts any
  message under `UNS/v1/`.
* The broker refuses its subscription (for example, Not authorized).
  Each service now subscribes itself on every connect and checks the
  broker's answer each time, instead of relying on the MQTT library's
  automatic resubscribe, which does not report a refusal.
* Historians only: a write to InfluxDB fails. This already ended the
  process, as an unhandled error; the exit is now deliberate and
  logged.
* UNS ingester only: a publish fails because the MQTT client has shut
  down for good. Other publish failures are logged and counted.

The settings are:

```yaml
historians:
  sparkplug:
    stallTimeout: 600
  uns:
    stallTimeout: 600
unsIngesters:
  sparkplug:
    stallTimeout: 600
```

Set a value to `0` to turn the check off for that service.

The check arms on the first message a service receives. A site with
no traffic at all, for example a new install with no edge agents, or a
UNS historian on a site where no device publishes ISA-95 hierarchy
information, does not restart. A gap longer than `stallTimeout`
after data has flowed does cause a restart. On a site with long quiet
periods, raise the value or set it to `0`. If the UNS ingester stops,
the UNS historian also restarts, then waits quietly for the first UNS
message.

The UNS historian also no longer exits on a message that is not valid
JSON. It logs the message's topic and skips it.

### Historians and the UNS ingester restart when they cannot connect

The stall check above arms on the first message, so it does not catch
a service that never receives one: for example, a service whose MQTT
client never connects after startup, or never reconnects after a
broker restart, on a site with no traffic. The Sparkplug historian,
the UNS historian and the UNS ingester now also watch their MQTT
connection, whatever the traffic. Each service exits, so Kubernetes
restarts it, if it has not been connected to the broker with a granted
subscription for `connectTimeout` seconds (default 300). The time
counts from startup, or from the moment the service lost its
connection or subscription. Reconnecting without a granted
subscription does not reset it.

A service that is connected and subscribed is healthy however quiet
the broker is, so quiet sites do not restart. A broker restart that
completes within the timeout causes no restart. The default of five
minutes allows for the broker and the KDC to restart during an
upgrade.

```yaml
historians:
  sparkplug:
    connectTimeout: 300
  uns:
    connectTimeout: 300
unsIngesters:
  sparkplug:
    connectTimeout: 300
```

Set a value to `0` to turn the check off for that service. An invalid
value, for example `5m`, stops the service at startup.

The services also now recognise a refused subscription with newer
MQTT.js releases, which report the refusal in a different form. Before,
such a refusal was logged as "not confirmed" and the service kept
running.

### i3X resubscribes to the UNS after a broker restart

After the MQTT broker restarted while i3X kept running, i3X reconnected
but its UNS subscription was not re-established. No UNS message
reached it again. Current values then changed only on the 5-minute
InfluxDB refresh, and i3X subscriptions received no live updates,
until i3X was restarted.

i3X now uses the same fixes as the historians and the UNS ingester:

* It subscribes to `UNS/v1/#` itself on every connect and checks the
  broker's answer each time, instead of relying on the MQTT library's
  automatic resubscribe. If the broker refuses the subscription, i3X
  exits, so Kubernetes restarts it.
* Once UNS data has started to flow, i3X exits if no UNS message
  arrives for `stallTimeout` seconds (default 600). Any message under
  `UNS/v1/` counts. A site with no UNS traffic at all does not restart.
* i3X exits if it has not been connected to the broker with a granted
  subscription for `connectTimeout` seconds (default 300), counted
  from startup or from the moment it lost its connection or
  subscription.

```yaml
i3x:
  stallTimeout: 600
  connectTimeout: 300
```

Set a value to `0` to turn that check off. An invalid value, for
example `5m`, stops i3X at startup. A restart drops i3X subscriptions,
and clients must create them again. On a site with long quiet periods
in UNS traffic, raise `stallTimeout` or set it to `0`.

### Data Access grows into Datasets

The Admin UI's Data Access page grows into **Datasets**, at
`/datasets`. It keeps the page's dataset model (devices, unions and
sessions over the Data Access service) and builds on it.
`/data-access` opens Datasets. Datasets adds a timeline of
equipment, devices and runs, a list, a page per dataset with charts,
a builder, one-metric compare across runs, an Add-ons page, and a
full-screen kiosk at `/kiosk/<equipment>` for recording runs from a
tablet next to a machine. A run is a time window over a piece of
equipment; equipment is a group of devices.

What changes on upgrade:

- **New ConfigDB objects.** Four dataset metadata applications (tags,
  equipment device labels, run metadata, and a recording held on the
  server while it runs), a **Run** functional class, and a
  **Dataset maker** client role. Service setup creates them.
- **Administrators can now see datasets.** The Administrator role gets
  every Data Access permission. Before, it had none, so an
  administrator saw an empty list.
- **Root and wildcard grants list every dataset.** The dataset lists
  now follow the same rules as single permission checks.
- **The Dataset maker role** holds what the Admin UI needs to make
  datasets and record runs: create, read, include, use for a session
  and edit every dataset, read every device's data, write dataset
  names and metadata, and set a dataset's kind. It does not include
  delete. Add people, and any kiosk tablet account, to this role.
- **Data Access creates an InfluxDB bucket and task.** At startup it
  creates the `acs_coverage` bucket and an hourly task, `acs-coverage`,
  that counts points per device per hour. It then backfills the whole
  history of the Sparkplug bucket, one day at a time with a pause
  between days, and repairs the last 7 days each night. On a large
  history the backfill takes hours; `GET /v1/coverage/status` reports
  progress to callers with `Use Sparkplug data` on every device. Set `COVERAGE_ENABLED=false` on the
  Data Access deployment to turn it off. Other settings are documented
  in the Data Access service reference.
- **New Data Access route `POST /v1/series`.** It returns, for a set of
  devices or a dataset over a window, the number of points per device
  per interval, the mean and point count per metric per interval, and
  the newest data time per device. The Admin UI uses it for data
  strips, charts and sparklines. Long windows read the coverage
  summary.
- **Dataset edits.** Editing a dataset's definition now checks the new
  definition fully before removing anything (from #806).

### Other improvements

ConfigDB:

- Notify watchers of the same class share one lookup, and a change
  re-runs only the lookups it can affect (#760, #776).
- A search watched by a client that reloads no longer drives ConfigDB
  to a full core of CPU (#762).
- Class member lookups are faster on large classes (#765, #766).
- A notify CLOSE request goes straight to its subscription, instead of
  past every open subscription (#779).

i3X:

- Bulk current-value reads are batched into a few InfluxDB queries,
  with at most 4 in flight (`I3X_INFLUX_CONCURRENCY`), and no longer
  time out after a restart (#761).
- i3X follows ConfigDB with one class watch and three ETag searches,
  instead of two watches per device and per schema, and fetches only
  the configs whose ETag changed. Those watches cost ConfigDB 0.65 to
  1.2 GB of memory on a large installation (#790).
- With MCP enabled, the search index is rebuilt when it is next used,
  not on every change (#771).
- A composition read whole from InfluxDB is answered from the cache
  next time (#792).

Edge agent:

- A node with many devices no longer crashes with "Maximum call stack
  size exceeded", and a config reload no longer fails with
  `EADDRINUSE` (#763).
- The driver's address map is sent once per event-loop turn, not once
  per device. In a benchmark with 7,302 devices the agent sent about 30
  maps instead of 7,303, and peak memory at start fell from about
  1.7 GiB to about 0.5 GiB (#767).
- Identical metric properties share one object, and a config without
  secrets skips a JSON round trip (#772, #773).
- Devices with no addresses no longer send empty polls to the driver,
  and driver data goes only to the devices that own its addresses (#774,
  #775).

Auth:

- The registration map is updated per change instead of rebuilt. In a
  benchmark with 25,000 registrations, the CPU cost of each update
  fell from about 48 ms to under 1 ms. This removes the load that made
  Keycloak's calls to Auth time out during bulk imports (#768).
- Entries that come from ownership can appear in a different order in
  an ACL, and so in the Effective permissions tab of the admin UI. The
  set of entries is the same.

## v6.6.0

### Upgrading: expect the Directory to be unavailable for several minutes

This release prunes the Directory's session table, and on an
installation which has been running for a long time there can be
millions of rows to remove. The prune runs as part of the database
migration, in the init container, so the Directory does not start until
it has finished.

On one installation with a 1.8GB session table this took **seven and a
half minutes**. Everything which depends on the Directory - the
Configuration Store, the historians, the command escalation service,
the UNS ingester - will fail and restart while it runs, and will back
off before recovering. They come back on their own once the Directory
is up, but the cluster looks unhealthy in the meantime and the recovery
is not instant, because Kubernetes backs off further on each restart.

Plan a maintenance window, and take a backup of the Directory database
first. The migration is a single transaction, so a failure rolls back
cleanly and leaves the database as it was, but it cannot be undone once
it has succeeded: the previous Directory will refuse to start against
the migrated database.

Installations which have not been running long have very little to
prune and will migrate in seconds.

### The Directory no longer asks devices to rebirth continuously

The Directory tracks which devices it believes are online so that it
does not ask a healthy device to re-send its birth certificate. That
check never matched, so the Directory concluded it had never seen any
device before and asked every device it heard from to rebirth, roughly
every five minutes, indefinitely.

Every one of those rebirths wrote a row to the session table, which is
the cause of the growth described below. Devices still rebirth normally
when they reconnect or when a consumer genuinely needs a birth
certificate; only the continuous re-asking has stopped.

### The Directory keeps only recent session history

The Directory recorded a session for every device birth and never
deleted any of them. On a long-running installation this accumulated
millions of rows, along with several times as many schema records. One
installation had a 5.6GB Directory database where every other database
on the same server was around 10MB.

The effect was that asking whether a device was online could take over
a minute, which used up every database connection the Directory had.
The visible symptoms were the admin interface hanging at login and
dashboards showing no data, even though data was still being collected
and stored normally throughout.

The Directory now keeps the current session and the one before it, for
each device and for each address, and prunes the rest as devices are
born. Existing installations are cleaned up by the migration described
above. No API exposes session history, and nothing that a dashboard or
an operator can see is different.

Two database indexes have also been restored. They were dropped in ACS
v3 and never replaced, which meant that finding the current session for
a device involved scanning the whole table - the single largest cost in
every device query.

### InfluxDB asks Kubernetes for the resources it needs

InfluxDB was scheduled with no resource reservation, which made it the
first thing the kernel would kill when a node ran short of memory,
taking the historians down with it and interrupting data collection. It
now requests CPU and memory. No limit is set, because InfluxDB's memory
use depends on how many distinct series a site collects; add one for
your deployment if you want a ceiling.

### The Sparkplug historian no longer exits on data for an unknown device

Receiving data for a device whose birth certificate had not arrived yet
would crash the historian, which stopped collection for every other
device as well. This could happen after a restart, or in the window
after the historian asks a device to rebirth and before it answers. The
metric is now skipped until the birth arrives.

## v6.5.0

### Choosing a schema for a device offers only the ones that fit

Setting a device's schema previously listed every schema in the
deployment, including `Axis`, `Spindle` and `Metric`. Those are parts of
a machine rather than things a machine is, and on a full library they
buried the twenty or so schemas anyone actually picks.

Schemas now declare whether a device can be built on them directly. The
picker shows those by default, with a checkbox to show everything, and
the schema editor has a toggle for it on locally authored schemas.

The flag lives in the schema body as `topLevel`, so it travels with the
file in the AMRC schema library. It is a non-standard JSON Schema
keyword, which validators ignore, and nothing in ACS validates schema
bodies, so it is inert for every other consumer.

A schema that says nothing is still shown, and the filter is switched
off entirely until at least one schema in the deployment carries the
flag. Nothing disappears from anyone's list unless it has been
explicitly marked as a component.

### The AMRC schema library ships marked

The bundled schema library moves to v1.6.0, in which all 139 schemas
carry the flag: 32 are machines and systems a device can be built on,
and the rest are parts used inside them.

This reaches existing installations, not just fresh ones. The loader
replaces a schema body whenever the stored `source` matches its own, so
a `helm upgrade` brings the marked library with it. Locally authored
schemas record a different source and are skipped, so anything you have
written or forked is untouched.

### Upgrading

A plain `helm upgrade`. Sites that pin `acs.schemas.image.tag`
themselves should move it to `v1.6.0` to pick up the marked library;
until they do, the picker behaves exactly as it did in v6.4.0.

## v6.4.0

### Schemas can be authored in the admin UI

A new **Schemas** section lets someone who knows what a machine measures
build a metric schema for it, without writing YAML or opening a pull
request against the AMRC schema library. Previously the only way to add
a schema was to hand-write it and get it merged upstream, which put
site-specific machine definitions in a shared repository and put days
between describing a machine and reading data off it.

Your deployment's ConfigDB is now the source of truth for its schemas.
The `acs-schemas` library is still loaded on install and upgrade, but it
is a starting point rather than the only source. Nothing in the editor
writes to git.

Library schemas are read-only, because the loader would overwrite any
local change on the next pull. Editing one makes a local copy under a
new name and its own version history, so a later AMRC release cannot
collide with your fork.

### Publishing tells you what a change breaks

When a locally authored schema is published, the editor compares it
against what is already published and classifies every difference.
Adding a metric, or changing documentation, a unit or a range, updates
the schema in place. Removing or renaming a metric, retyping one, or
narrowing its allowed Sparkplug types creates a new version instead and
leaves the old one exactly as it is, so nothing moves underneath a
running device.

Which of the two happens is decided by the comparison, not chosen. The
publish screen states the outcome, lists the changes that produced it,
and shows how many devices are configured to use the schema alongside
how many are publishing it right now. Those two numbers mean different
things and are reported separately; if the Directory cannot be reached
the live figure reads as unknown rather than zero.

A device using a superseded schema shows that a newer version exists.
Moving it across is still a deliberate origin map edit.

### Choosing a schema for a device

The schema selector on a device is now a searchable list rather than a
dropdown of several hundred names. It shows whether each schema is
yours or from the library, its version, and how many devices already use
it, and it is materially faster: the list previously did work
proportional to the square of the number of schemas, which on a full
library blocked the browser for about a second every time it rendered.

### Upgrading

A plain `helm upgrade`. `service-setup` registers the two new ConfigDB
objects the editor needs (a class holding drafts and the application
holding their working state); until it has run, the schema list works
but creating a schema does not. Existing schemas, devices and origin
maps are untouched, and nothing about how the edge agent consumes
schemas has changed.

## v6.3.0

### Cross-realm Kerberos login

Someone holding an account in a foreign Kerberos realm that this
cluster already trusts can now sign in, without an administrator
creating a Factory+ principal for them by hand. Previously this failed
at the identity lookup, before the password was ever checked, and
reported "Invalid username or password" whatever was typed. Cross-realm
trust is an arrangement between KDCs and provisions nothing in
Factory+, so there was no principal to find.

Enter the full principal name, `alice@OTHER.REALM`, rather than a bare
username; a bare username still means an account in this cluster's own
realm. The password is verified by an AS-REQ against the named realm's
own KDC, the only KDC that can verify it, so this cluster's `krb5.conf`
must list that realm and be able to reach it. On success a principal is
created here with the Kerberos identity attached, and it appears in the
ACL editor like any other. It starts with no permissions.

Trusted realms are opt-in and nothing is trusted by default:

```yaml
openid:
  trustedRealms:
    - realm: OTHER.REALM
```

Principal UUIDs are derived from the principal name (a UUIDv5 in a
fixed namespace) rather than generated at random. Every cluster
trusting a given realm therefore agrees on the same UUID for the same
person, and permissions can be granted before that person has ever
logged in. The `acs-keycloak-spi` README documents how to compute one.

A realm entry may optionally carry an `authUrl` pointing at that
realm's own Factory+ Auth service, in which case this cluster adopts
the UUID the home cluster already holds instead of deriving one. That
requires a principal for this cluster's `sv1openid` to exist on the
home cluster, holding ReadKrb. Note that ReadKrb is a blanket
permission: it confers read and enumeration of that cluster's entire
identity table, and cannot be scoped to individual principals. Pick one
mode and stay with it. Adding an `authUrl` later does not migrate
anyone who has already signed in, so the estate divides according to
when each person first logged in, and converging afterwards means
re-pointing identity records by hand.

### Fully qualified usernames now work

Entering a username with its realm attached, `alice@THIS.REALM`,
failed on every v6 cluster, including for local accounts, and presented
as "Invalid username or password". Keycloak folds usernames to lower
case before the Factory+ user store sees them, and Factory+ matches
identity names exactly, so the realm portion never matched what was
stored. The lookup now retries with the realm upper-cased. Bare
usernames were never affected and behave as before.

The part before the @ is still matched as Keycloak supplies it, which
is to say lower-cased, so a Factory+ identity recorded with capitals
there will still not match.

### Login page matches the admin UI

The Keycloak login page was rendering at 87.5% of its intended size,
because the theme set a 14px root font size while every dimension in it
was authored against the browser default of 16px. It now matches the
acs-admin login card: same width, padding, control heights, title and
description, and the same input and focus colours. The button shows a
spinner while a login is in flight, which matters more now that a
cross-realm login can involve a round trip to another realm's KDC.

## v6.1.4

### Keycloak upgraded from 26.1 to 26.6

The bundled Keycloak moves to 26.6.3, primarily for its PostgreSQL
JDBC driver (42.7.11): the 42.7.4 driver shipped with Keycloak 26.1
has a bug (pgjdbc #3373) where the GSS-encrypted database stream is
corrupted by partial TCP reads, crashing Keycloak with "Could not use
AES128 Cipher - Checksum failed" under network conditions that split
GSS tokens across reads. Seen in production; the trigger is
environmental (TCP segmentation behaviour), so any site can hit it.

Keycloak migrates its database schema one-way on first start of the
new version; downgrading afterwards requires a database restore. The
F+ SPI is rebuilt against 26.6 (no source changes needed) and the
chart now uses the KC_BOOTSTRAP_ADMIN environment variables in place
of the KEYCLOAK_ADMIN ones deprecated in Keycloak 26 (only consulted
when the master realm has no admin, so inert on established sites).
Keycloak 26.2-26.6 also tightens some token-endpoint behaviour
(introspection audience checks, userinfo with lightweight tokens);
none of it affects the flows ACS provisions, but sites with custom
OIDC clients should skim the upstream migration notes.

## v6.1.3

### ACL editor shows identity-less principals

The admin UI's principal list now includes principals without a
kerberos/sparkplug identity, shown with a "No identity" placeholder.
In particular the F+ principals created for OIDC service accounts
(v6.1.1) can now be granted permissions through the standard editor,
so setting up an unattended visualiser wall no longer requires the
Auth API directly.

## v6.1.2

### service-setup survives duplicate Keycloak protocol mappers

A Keycloak client holding two same-name protocol mappers (possible
when two service-setup jobs race, since Keycloak does not enforce
name uniqueness on create) failed every subsequent client update
with a 500, permanently bricking service-setup. Client updates no
longer echo the mapper list, and duplicate F+ mappers are deleted
automatically on the next run.

## v6.1.1

### Service-account OIDC clients get Factory+ principals

Each `serviceAccountsEnabled` OIDC client now gets an F+ Principal
("Service account: <name>" in the ACL editor), and its
client-credentials tokens carry `fp_principal_uuid`, so unattended
consumers (visualiser walls, scheduled jobs) can be granted F+
permissions like any other principal and can authenticate to the F+
HTTP services and the MQTT broker. Previously such tokens were
rejected by the HTTP services and received an empty MQTT ACL. A fresh
service account holds no grants; grant its principal the permissions
it needs (e.g. MQTT read for a wall) via the ACL editor.

## v6.1.0

This release moves the visualiser onto the central Keycloak login and
teaches the MQTT broker to accept JWTs. There are no breaking changes;
upgrading from v6.0.x is a plain `helm upgrade`.

### Visualiser logs in through Keycloak

The visualiser no longer shows its own username/password form on
cluster deployments. Opening it redirects to the Keycloak login page
(sharing the SSO session with Grafana and anything else on the realm)
and returns with a JWT, which is used for the Directory, ConfigDB and
the MQTT websocket connection. Tokens are refreshed automatically
before expiry, so a tab left open stays live. Pressing Escape logs out
through Keycloak's end-session endpoint.

The chart provisions a public `visualiser` OIDC client (PKCE S256)
automatically via service-setup. The old form remains only as a
fallback when `OIDC_DISCOVERY_URL` is not configured (local
development).

### Visualiser kiosk URL login

For unattended displays the visualiser accepts
`?auth_token=<JWT>` in the URL, matching Grafana's `url_login`, and
strips the token from the address bar immediately. No refresh happens
in this mode: mint kiosk tokens from a service-account
(client-credentials) OIDC client with a long `accessTokenLifespan`
(see `serviceSetup.config.openidClients` in values.yaml), the same
pattern used for Grafana kiosk walls.

### The MQTT broker accepts JWTs as passwords

The HiveMQ auth plugin now recognises a Keycloak JWT presented as the
MQTT password (any username; identity comes from the verified token's
`preferred_username`). Verification uses the realm's JWKS via
`OIDC_DISCOVERY_URL`, mirroring the HTTP services, and the normal MQTT
ACL lookup runs on the token's principal. Kerberos passwords and
GSSAPI are unaffected; the JWT path only engages when the password is
shaped like a JWT and openid is enabled.

## v6.0.0

This is a major release. It changes the Sparkplug timestamp format, the
way users log in to Grafana, the bundled Grafana version, and two
ConfigDB permissions. None of these are backwards compatible, and
several of the Grafana and Directory changes are one-way. Please read
this whole section before upgrading a production installation.

Note that v4 and v5 were not documented here; this section describes the
changes from v5.1.0.

### Upgrade procedure

The detail is in the sections below; this is the order to work in.

1. **Before you start**, add DNS records for the three new external
   hosts (`openid`, `i3x`, `data-access`) and make sure your TLS
   certificate covers them. The chart's Let's Encrypt certificate
   includes each of these hosts automatically while its service is
   enabled, so create the DNS records **before** upgrading: a name on
   the certificate that does not resolve fails the HTTP-01 challenge and
   blocks issuance and renewal of the whole certificate. If you disable
   a service, its host is left off the certificate and needs no record.
   The certificate now also covers `files.<baseUrl>` and
   `influxdb.<baseUrl>`, which were served in v5 but missing from the
   certificate; a Let's Encrypt site without DNS records for those two
   must add them before upgrading, for the same reason. A wildcard or
   externally-managed certificate needs nothing.
2. **Snapshot two persistent volumes.** The Grafana volume, because the
   dashboard and playlist migrations are one-way and cannot be rolled
   back. And the shared Postgres volume, because the Directory database
   migrates to a new schema version on first start of a v6 Directory
   pod, and a v5 Directory pod will not start against it - a rollback
   without the snapshot leaves both Directory pods in CrashLoopBackOff.
   (If you are caught in that state, the minimal repair is
   `update version set version = 12;` in the `directory` database.)
3. **Run `helm upgrade`, then watch the `service-setup` Job.** It is a
   plain Kubernetes Job, not a Helm hook, so `helm upgrade` reports
   success before the Job has done any work. The permission grants,
   the Keycloak realm and client provisioning, and the service
   registrations all happen inside it. On a cluster whose Keycloak is
   starting for the first time the Job can take several minutes while it
   waits for Keycloak to become ready, and it retries until it succeeds,
   so a Job that has not yet completed is not necessarily failing. Wait
   for it to complete before relying on the upgrade.
4. **After it completes**, confirm the Grafana migrations before you
   rely on the install or upgrade the edge agents. A playlist that fails
   to migrate is recorded as done and never retried, and the ones that
   did migrate still render, so looking at the playlist list in the UI
   will not tell you a playlist is missing. Instead check the Grafana
   log for the `Count validation` line on `playlists.playlist.grafana.app`
   and confirm `rejected=0` with `legacy_count` equal to `unified_count`.
   If `rejected` is not zero, restore the Grafana volume snapshot, fix
   the offending playlists, and upgrade again. Then sign in to confirm
   your dashboards are present, and run **Import from Devices** on the
   ISA-95 page if you have existing hierarchy values.
5. **Upgrade the edge agents last**, once the central services are on
   v6 (see the timestamp section).

### Nanosecond timestamps: upgrade central services before edge agents

Sparkplug payload and metric timestamps now hold **nanoseconds** since
the epoch, in the same `uint64` field that previously held milliseconds.
The UNS JSON `timestamp` field is likewise now an ISO-8601 string with
nanosecond precision, for example `2026-05-28T15:46:56.100923659Z`
rather than `2026-05-28T15:46:56.100Z`.

Components from this release read a timestamp below 1e15 as milliseconds
and convert it, so a v6 central service can consume data from a v5 edge
agent. **The reverse is not true.** A v5 historian reading from a v6
edge agent treats the nanosecond value as milliseconds; the number is
far larger than any date the historian can represent, so it becomes an
invalid time and those points are not stored rather than being written
with a wrong timestamp. Either way the data is lost until both ends are
on v6, so upgrade the central services first and the edge agents last.

Edge agents are upgraded by the edge Helm charts, which you control, so
the ordering is yours to enforce: do not roll an edge cluster to v6
until its central services are on v6.

Two further consequences:

- The Sparkplug B specification defines this field as milliseconds. Any
  external, non-ACS consumer that reads ACS Sparkplug payloads directly
  will misinterpret the new values, and any consumer of the UNS topics
  with a strict RFC 3339 parser may reject the extra digits of
  precision.
- Existing InfluxDB data is unaffected and needs no migration. Both
  historians already wrote at nanosecond precision, so stored timestamps
  and measurement names are unchanged.

### Grafana now authenticates through Keycloak

Previously Grafana sat behind a Traefik `basic-auth` middleware and
trusted a proxied header (`auth.proxy`). This release deploys Keycloak
as an OIDC provider and Grafana authenticates against it. The
`grafana.grafana.ini.auth.proxy` values have been removed, and Grafana's
own login form is hidden: users sign in via a "Factory+" SSO button.

Keycloak itself validates credentials against Kerberos, and Kerberos
authentication is otherwise unchanged. Edge agents, the Manager and the
other central services continue to authenticate exactly as they did.

On upgrade you must:

- Create a DNS record for the new `openid.<acs.baseUrl>` host and ensure
  the certificate Grafana's browser is served covers it. The chart's
  Let's Encrypt certificate includes the host automatically while
  `openid` is enabled, so the record must exist before the upgrade (see
  the upgrade procedure). The Keycloak discovery endpoint
  must also resolve and present a valid certificate *from inside the
  cluster*, because the `service-setup` Job calls it there; a split-horizon
  DNS setup that only answers externally will wedge the Job.
- Grant Grafana roles through Factory+ permissions. Roles are no longer
  held in Grafana. The two roles are Factory+ permissions listed under
  `serviceSetup.config.grafanaPermissions` (Grafana Admin and Grafana
  Editor); grant one to a principal with the Factory+ ACL editor, using
  the wildcard target, and it arrives in the `fp_permissions` claim on
  the principal's next login. Anyone without a grant is a Viewer, and
  revoking a grant demotes the user at their next login. The maximum role
  is Admin; Grafana's server-admin (GrafanaAdmin) is no longer assigned.
  Members of the **Administrator** group get Grafana Admin automatically
  through the shipped ACLs, so an operator who is already an
  Administrator needs no further action.
- Existing Grafana accounts are reclaimed automatically. Federated logins
  arrive with the Kerberos UPN as the username, which is the same string
  the v5 proxy login used, and Grafana matches the returning user to
  their existing account and keeps their dashboards and role. (This
  relies on `oauth_allow_insecure_email_lookup`, which the chart sets;
  the "insecure" here only means Grafana trusts the email the identity
  provider asserts, and that provider is your own Keycloak backed by
  Kerberos.) The one account that may not reclaim cleanly is the local
  emergency admin: see below.

The Keycloak deployment uses the custom `acs-keycloak` image, which has
the Factory+ storage provider built in. Stock upstream Keycloak will not
work. The Keycloak admin password, the client secrets and the Keycloak
database are all created automatically; there is no manual realm or
client configuration to do.

Setting `openid.enabled` to `false` will skip Keycloak, but Grafana then
has no interactive login at all. Hiding the login form does not leave a
back door: Grafana does not register the password login client when
`auth.disable_login_form` is set, so the local admin account cannot sign
in interactively or over the API, and there is no query parameter that
re-enables the form. To recover access, put the form back with a values
override and restart the Grafana pod:

```yaml
grafana:
  grafana.ini:
    auth:
      disable_login_form: false
```

On a cluster upgraded from v5, the `grafana-admin-user` Secret from your
v5 installation is kept (it carries `helm.sh/resource-policy: keep`), so
the local admin is still `admin@<REALM>`. On installations first seeded
before the admin password was randomised, that account's password is
Grafana's built-in default `admin`, not the random value a fresh v6
install generates. Treat it as a live credential: it is the account you
would use with the break-glass override above, and its password should
be rotated. Whether signing the admin principal in through SSO adopts
this local account was not verified during the upgrade testing, so do
not rely on SSO to reclaim it; keep it as a local login reached through
the break-glass override.

### Grafana upgraded from v10 to v12

The bundled Grafana image moves from 10.0.1 to 12.4.5. Grafana 10.x
left support in 2024, so this catches up two majors of security fixes,
and the newer `auth.jwt` support is what lets machine-to-machine
consumers sign in with tokens (see below).

This release deliberately stops at 12.4.x rather than 13.x. Grafana 13
removed the schema migration that adds the `playlist.created_at` and
`updated_at` columns, which were introduced in 10.2.0, while still
running a playlist migration that requires them. A database created by
the Grafana 10.0.1 that ACS v5.1.0 shipped therefore cannot start under
Grafana 13 at all. Grafana 12.4.x still ships that migration, so it
adds the columns and completes the playlist migration itself; a later
move to 13 will then be safe.

Three upstream Grafana changes are worth knowing about when upgrading
an existing installation:

- Your playlists and dashboards are migrated into Grafana's unified
  storage on first boot, and the migration is one-way: once the new
  image has written to the Grafana database you cannot return to the
  previous one. This is why the upgrade procedure has you snapshot the
  Grafana volume first. Check after upgrading that the playlists you
  expect are all present before you rely on the installation. The
  playlist migration logs a warning and carries on rather than failing
  if it rejects an individual playlist, so a clean run is not enough on
  its own - confirm the Grafana log shows a `Count validation` line for
  `playlists.playlist.grafana.app` with `rejected=0` and
  `legacy_count` equal to `unified_count`. A non-zero `rejected` means
  some playlists did not migrate and, because the migration then records
  itself as done, will not be retried; restore the volume snapshot,
  correct the offending playlists, and upgrade again.
- The chart keeps folders and dashboards on Grafana's legacy storage by
  pinning `autoMigrationThreshold` to 1 for both. Grafana 12 otherwise
  auto-migrates them into unified storage on any installation with fewer
  than ten dashboards, so without the pin a small site would silently
  take that one-way migration while a large one would not. There is no
  action for you here unless you override those values; do not.
- Support for AngularJS plugins has been removed (disabled by default
  in Grafana 11, gone entirely in 12). Grafana's built-in panels are
  unaffected and legacy Graph/Table panels are migrated automatically,
  but any third-party Angular panel or data source plugin will no
  longer render. Audit your dashboards for these before upgrading.
- Links that deep-link a single panel changed format in Grafana 11
  (`?viewPanel=5` became `?viewPanel=panel-5-…`), so bookmarks and
  kiosk URLs pointing at individual panels need re-copying from the new
  UI. Links to whole dashboards, including kiosk-mode links, are
  unchanged.

Also removed upstream, though ACS does not deploy either: the image
renderer plugin and legacy alerting. If you added one of those to your
own installation, migrate off it before upgrading.

### Machine-to-machine OIDC clients

Clients declared under `serviceSetup.config.openidClients` may now set
`serviceAccountsEnabled: true`, which turns on the OAuth
client-credentials grant so an unattended consumer, such as a display
wall or a scheduled job, can exchange its generated client secret for a
token without a human login. Such a client should normally also set
`standardFlowEnabled: false`, as it has no browser session to redirect.
Keycloak only supports service accounts on confidential clients, so the
flag is ignored on a client marked `publicClient`.

A client may also set `accessTokenLifespan` (in seconds) to override the
realm's access-token lifespan, which defaults to 300 seconds, for that
one client. This matters for an unattended display: a wall that signs a
Grafana panel in with a token (Grafana's `auth.jwt` `url_login`) holds
no session and re-presents the same token on every request, so it stops
working the moment the token expires and drops to a login screen. Give
such a client a long-lived token - for example `2592000` for thirty days
- and let the consumer refresh it before expiry. A kiosk needs both
`serviceAccountsEnabled` and `accessTokenLifespan`; the service account
alone still expires at the realm default. Leaving `accessTokenLifespan`
unset keeps the realm lifespan, so nothing changes for clients where a
human signs in.

If such a client reaches Keycloak's JWKS endpoint over plain HTTP -
which happens with Grafana's `auth.jwt` on a cluster deployed with
`acs.secure: false` - Grafana will not fetch the signing keys over HTTP
and exits at startup with `jwt_set_url must have https scheme`. Running
it in development mode (`GF_DEFAULT_APP_MODE: development`) lifts that
restriction. A production deployment serves HTTPS and needs neither the
override nor that concern.

These settings are off unless asked for, and existing clients are
unaffected.

### Two new services are exposed by default

`i3x` and `data-access` are both enabled by default, and each publishes
an external host: `i3x.<acs.baseUrl>` and `data-access.<acs.baseUrl>`.
Add DNS records and ensure your TLS certificate covers them, or set
`i3x.enabled` or `dataAccess.enabled` to `false`. The chart's Let's
Encrypt certificate includes each host automatically while its service
is enabled, which is why the DNS records must exist before you upgrade;
a disabled service's host is left off the certificate. These services
use only cluster-internal URLs at runtime, so a missing DNS record or
an uncovered host does not stop them running; it stops the Manager's
Explorer page and the browser-facing API from reaching them.

### i3X authenticates every request but does not authorize per object

i3X is enabled by default and serves the entire Unified Namespace, live
values and history, over `i3x.<acs.baseUrl>`. It authenticates every
request - a call with no valid Factory+ credential is refused, apart
from the public `/v1/info` endpoint - but it performs no per-object
authorization. Any principal that can obtain a Factory+ token can read
the whole namespace through i3X, and that includes every edge agent
service account whose keytab sits on a shop-floor device. This is a
wider audience than in v5, where the same data was gated per principal
by the MQTT and InfluxDB ACLs. The same authentication-only gate covers
the `/mcp` endpoint, which exposes the namespace to an MCP client.

If that exposure is not acceptable for your site, set `i3x.enabled` to
`false`. Doing so also withdraws i3X's advertisement from the Directory,
which leaves the Explorer page and the live values in the Manager's
Monitor view without a data source, since both read from i3X.

i3X does not hard-depend on Keycloak. With `openid` disabled it still
accepts Kerberos and the other Factory+ credential types and simply
stops accepting OIDC bearer tokens, so disabling `openid` degrades i3X
rather than breaking it.

### ConfigDB permission changes

Adding a subclass relationship now requires the `WriteSuperclasses`
permission on the target class, where previously `ReadSubclasses` was
enough. The accounts shipped with ACS are updated automatically, but
**any local principal that creates subclasses must be granted the new
permission**, otherwise those writes will start returning 403.

The Files service now also requires `ReadMembers` on the file class,
without which file operations fail with permission errors.

Both grants are applied by the service-setup Job, which runs
automatically as part of `helm upgrade`.

### ConfigDB version 1 dumps are no longer accepted

Support for the version 1 dump format has been removed. Any dumps you
maintain outside this repository must be converted to version 2.

### Service registration has moved into the Helm chart

Service URLs used to be registered from a fixed dump baked into the
service-setup image. They are now generated by the chart and gated on
each service's `enabled` flag, so only the services you actually deploy
are advertised in the Directory. No change to your values file is
needed, and no stale registrations need clearing out. The Directory
database picks up a new schema version automatically on startup, which
makes the `device` column of a service advertisement optional.

### The ISA-95 hierarchy is now a controlled vocabulary

The five ISA-95 levels (Enterprise, Site, Area, Work Centre, Work Unit)
are no longer free-text fields on a device. They are selected from a
vocabulary of ConfigDB objects, which prevents the inconsistent spelling
of site and area names that free text allowed.

The vocabulary is managed from the new **ISA-95** page in the Manager,
where hierarchy nodes can be created, renamed, given alternative names
(aliases) and pruned. A node cannot be deleted while it still has
children, so a hierarchy is dismantled from the bottom up rather than
leaving orphaned nodes behind.

Nothing seeds the vocabulary automatically: the bundled dump creates
only the five level classes and the vocabulary application. Until nodes
exist, the hierarchy dropdowns on a device are empty and the hierarchy
cannot be set.

**If you are upgrading an installation that already has hierarchy values
typed against its devices,** use "Import from Devices" on the ISA-95
page rather than retyping them. This reads the values already saved on
every device, shows you what it proposes to create, and builds the
vocabulary to match. Names that differ only in case or spelling from an
existing node are attached to that node as aliases, so a device keeps
resolving against the vocabulary without being edited. Devices are never
modified by the import. Values that sit below a missing level (an Area
on a device with no Site, say) cannot be placed in the tree; they are
reported and left alone.

The import is deliberately a manual action rather than something that
runs on upgrade. Nodes are derived from device values, which the import
does not rewrite, so a migration that ran automatically would recreate
any node you had pruned every time the chart was upgraded. Run it when
you choose to, prune what you do not want, and the result stays as you
left it. You can run it again at any time to pick up devices added
later.

CSV import ignores the ISA-95 columns for the same reason the metric
tree hides them. They are still present in an exported CSV, but editing
them and re-importing will not change the hierarchy; use the ISA-95
Hierarchy panel on the device, or the ISA-95 page, instead.

### MetaDB is present but disabled

This release includes the first parts of the MetaDB, an RDF-backed
reimplementation of the ConfigDB. It ships disabled and its integration
is not yet complete, so it should not be enabled on a production
installation. Turning on `metadb.asConfigDB` repoints the Directory's
ConfigDB advertisement at the MetaDB and requires `configdb.enabled` to
be `false`; there is no migration of existing ConfigDB content into it.

## v3.4.0

### Unified Namespace & Historian
This release of ACS enables a true Unified Namespace (UNS). The UNS is a
single point of truth for all data collected by ACS in human-readable
format. The UNS is "fed" by ingesters, which take channels of data (in
this case, Sparkplug), and publishes the human-readable content to
`UNS/v1`. In the future additional ingesters may be added to ACS.

In addition to the Sparkplug ingester, this release features a UNS 
historian, which persists the UNS data to the same InfluxDB 
database used by the legacy Sparkplug historian. **By default, the 
UNS historian is disabled** in an effort to minimise the impact of
this change on existing installations. To enable the UNS historian,
set the `historians.uns.enabled` environment variable to `true`. If 
you only want to exclusively persist UNS data (and not legacy 
Sparkplug data) then set `historians.sparkplug.enabled` to `false`.

## v3.1.0

### Administration interface
A new administration interface has been added to ACS, which will slowly
become the single-point-of-contact for all administrators and managers
of ACS installations. Currently this interface only exposes the new
alerts system, but will be expanded in future releases. It can be
accessed from the base URL of your ACS installation. 

### Global admin account changes

The 'Global Administrator Account' user account is now created with a
UUID specific to this installation of ACS. Once this has been done the
old account object (`d53f476a-29dd-4d79-b614-5b7fe9bc8acf`) can be
deleted.

The password for this account has moved from the `krb5-passwords` K8s
Secret into a dedicated Secret for this purpose, `admin-password`. This
contains a single key `password` holding the account password.

Note that this account bypasses all ACLs and should not be used for
normal operation.

### Removed client roles

Previously ACS deployed a Client Role called 'Global Debugger'
(`4473fe9c-05b0-42cc-ad8c-8e05f6d0ca86`). This was
a Group of permissions within the Auth service which was granted in the
`permission` slot of access control entries. It was only useful if
granted with a wildcard `target`.

This has been replaced by a Group of users called 'MQTT global
debuggers' (`f76f8445-ce78-41c5-90ec-5964fb0cd431`). Accounts and groups
which should have global MQTT access should be added to this group; the
group should not appear in any additional access control entries.

Accounts created by the ACS installation will have been updated to be
members of the Group, but ACLs referencing the Client Role and the Role
itself will not have been removed. Any local accounts using the Role
should be updated to be members of the Group instead, and then any
access control entries referencing the Role (and the role itself)
should be removed.

### TLS certificate namespace
IngressRoutes are now namespaced to the namespace of the chart release.
Previously they were namespaced to the `default` namespace. This means
that if you are providing your own wildcard TLS certificate you will
need to ensure that it is moved from the `default` namespace to the
namespace of the ACS release, otherwise Traefik will serve the default
certificate instead.

## v3.0.0

This is a major release, with fundamental changes to the architecture.
[Detailed release notes are available
here.](../getting-started/whats-new-in-v3.md)
