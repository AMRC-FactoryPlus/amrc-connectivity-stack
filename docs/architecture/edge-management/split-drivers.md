# Split Drivers

An Edge Agent reads devices in one of two ways. Some protocols are built
into the Edge Agent itself. Others run as a split driver, which is a
small container (a sidecar) in the Edge Agent's pod that talks to the
device and passes what it reads to the Edge Agent over a broker inside
the pod. Modbus, BACnet, ADS and the other drivers with their own image
have always worked this way. The built-in REST, MQTT and OPC UA
connections are moving to split drivers so that every protocol is
deployed, versioned and fixed in the same way. The protocol between the
Edge Agent and a split driver is described in
[`acs-edge/docs/edge-split.md`](../../../acs-edge/docs/edge-split.md).

REST is the first to move. Its split driver is `edge-rest`. MQTT and
OPC UA keep their built-in connections until their drivers are ready.

## The setting

The ACS chart moves connections between a built-in connection and its
split driver with `serviceSetup.config.splitDrivers` in its values:

```yaml
serviceSetup:
  config:
    splitDrivers:
      REST: true      # the chart's default
      # MQTT, OPCUA: not set, so they stay built in
      # dryRun: true  # log what would move and change nothing
```

Each protocol takes one of three values:

| Value | What service-setup does on every install or upgrade |
|---|---|
| `true` | Moves every connection of that protocol to its split driver. |
| `false` | Moves every connection of that protocol back to the built-in connection. |
| `null`, or not set | Leaves the connections where they are. |

Helm merges your values over the chart's, so you only need to set the
protocol you want to change. To stop REST moving at all, set
`REST: null`. With `dryRun: true`, service-setup logs each change it
would make and writes nothing, which is a safe way to see what an
upgrade will do before you make it.

## What an upgrade does

For each built-in REST connection, service-setup:

1. changes the connection's driver to the REST split driver;
2. changes the connection's entry in its Edge Agent's config from
   `connType: REST` with `RESTConnDetails` to `connType: Driver` with
   `DriverDetails`, keeping every field (base URL, authentication,
   devices, addresses, paths and payload formats) as it was;
3. adds an `edge-rest` sidecar for the connection to the Edge Agent's
   deployment.

A connection whose name can't be used as a container or MQTT name (for
example one with a dot, an underscore or a space in it, such as a name
taken from a web address) is given a driver id, such as
`api-example-org-1a2b3c4d`, and its sidecar is named after that id. The
connection keeps its name everywhere else.

The Edge Agent reloads its config as soon as service-setup writes it,
and its pod restarts with the new sidecar once the edge cluster has
applied the new deployment, which normally takes a few minutes. An
upgrade already restarts every Edge Agent once for its new image, so
expect an Edge Agent with REST connections to restart once or twice in
the minutes after the upgrade, and its REST devices to have no data for
that time.

Service-setup runs the move on every install and upgrade, and a second
run finds nothing to change. A run that stopped half way through is
finished by the next one.

### New connections

After the upgrade, the connection form in the Manager offers one REST
driver, called "REST", which is the split driver. The built-in driver is
called "REST (built-in)" and is shown only on a connection that still
uses it, for example on a site that has moved REST back.

## Edge charts and every split driver move

This section applies to every protocol's move to a split driver: REST
now, and MQTT, OPC UA and UDP when they follow. It is a property of how
the edge Helm charts reach edge clusters, not of any one driver.

An Edge Agent and its split driver sidecars take their image tag from
the edge Helm charts, which every image in one ACS release shares. Each
install or upgrade of the central cluster writes that release's charts
to the `acs` branch of the `shared/helm` git repository on the central
cluster. Edge clusters deploy from the `main` branch of the same
repository, which they check every few minutes. The upgrade moves
`main` to the new charts only if nobody has committed to `main`. A site
that has committed its own changes to `main` (for example a changed
resource limit or an extra chart) must merge `acs` into `main` itself
on every upgrade, and until it does, its edge clusters keep running the
older release's images.

That was already true for every image, but a split driver makes it
cost data. A split driver that is new in a release has no image at an
older release's tag, so on an edge cluster still running older charts
its sidecar can't start, and a connection moved to it gets no data. The
connection's config has already moved, because service-setup moves it
on the central cluster, which doesn't know which charts the edge
clusters run.

### Before you upgrade

1. **Check whether your site has its own edge chart changes.** List the
   two branches of the chart repository, signing in as the ACS admin
   user when asked:

   ```sh
   git ls-remote https://git.<your ACS domain>/git/shared/helm refs/heads/main refs/heads/acs
   ```

   If both lines show the same commit hash, nobody has changed `main`
   and the upgrade moves it for you, so there is nothing more to do.
   If they differ, your site has its own changes, so carry on.
2. **Plan to merge `acs` into `main` straight after the upgrade.** Once
   the service-setup Job has finished, clone the repository, merge
   `origin/acs` into `main`, keeping your own changes, and push `main`.
   The edge clusters pick it up within a few minutes.
3. **Or hold the move back.** If you can't merge straight away, set the
   protocol to `null` under `serviceSetup.config.splitDrivers` (for
   example `REST: null`) for this upgrade. Its connections then stay
   built in, and you can set it back to `true` on a later upgrade, once
   you have merged.

The service-setup Job's `edge-helm-charts` container logs a line
starting `WARNING: branch main of shared/helm has commits of its own`
whenever it leaves `main` alone, so you can also check after the
upgrade.

### If an upgrade has already moved connections

If the upgrade moved connections to a split driver and your edge
clusters didn't get the new charts, the moved connections' devices show
no data, and each Edge Agent pod has a `driver-<name>` container that
can't pull its image (`ImagePullBackOff`). To recover, do either of
these:

- Merge `acs` into `main` in `shared/helm` and push it, as in step 2
  above. Within a few minutes the edge clusters run this release's
  images, the sidecars start, and the data comes back. Nothing else
  needs doing.
- Set the protocol to `false` and upgrade again. The connections move
  back to the built-in connection, exactly as they were, and their
  sidecars are removed.

One more case looks the same: an edge cluster that can't fetch from
the central git server keeps its old charts, but if its Edge Agent can
still reach the ConfigDB, it loads the moved config and waits for a
sidecar that hasn't arrived. Its moved devices have no data until the
edge cluster can fetch again. Check that every edge cluster is syncing
before you upgrade.

## What changes for a REST connection

`edge-rest` sends the same requests and hands the Edge Agent the same
replies as the built-in connection, so the data your devices publish
doesn't change. Its full behaviour is in
[`edge-rest/README.md`](../../../edge-rest/README.md). You may notice
these differences:

- **Failures are logged once.** A failing endpoint (an error reply or
  no reply) is logged once until it recovers, where the built-in
  connection logged it on every poll.
- **Devices go offline only when the whole connection fails.** One
  failing endpoint doesn't take the other devices on the connection
  offline. The connection reports a problem, and its devices are
  marked offline, only when every endpoint has failed for a whole poll
  round. It then tries every failing endpoint every 5 seconds and comes
  back as soon as one answers.
- **Requests time out.** A request gives up after 25 seconds. The
  built-in connection waited for ever.
- **Page counters work.** An address with a page counter such as
  `${1:_}` is read page by page and the pages are joined into one JSON
  array. The built-in connection never finished reading these.
- **Writes send one value.** A write to a REST metric is a POST of the
  value alone as JSON, and the Manager shows the value as written only
  once the device replies with success. The built-in connection posted
  a body built from every metric on the address.
- **One more container per connection.** Each REST connection runs in
  its own `edge-rest` container in the Edge Agent's pod.

## Checking it worked

1. In the service-setup Job's log, find the line that starts
   `Split drivers:`. It gives how many connections moved and how many
   failed, and the lines above it name each connection.
2. In the Manager, open a REST connection. Its driver is "REST".
3. On the edge cluster, the Edge Agent's pod has a `driver-<name>`
   container for each REST connection, and each is running.
4. The connection's devices are publishing data again a few minutes
   after the upgrade.

## Moving back

Set `REST: false` under `serviceSetup.config.splitDrivers` in your
values and upgrade. Service-setup moves every REST connection back to
the built-in connection, removes its sidecar, and leaves each
connection's config exactly as it was before it moved. A REST
connection created in the Manager after the move uses the split driver,
and the next upgrade with `REST: false` moves it to the built-in
connection too.

## Adding a protocol's migration

This is for developers moving another built-in protocol (MQTT, UDP, OPC
UA) to its split driver. Follow what REST did:

1. **DriverDefs.** In `acs-service-setup/dumps/edge.yaml`, the split
   DriverDef already exists and is hidden. Remove its `hidden`, name it
   plainly (for example "MQTT"), and hide the built-in and name it
   "MQTT (built-in)". Both changes are needed, because the connection
   form picks drivers by name. Update the "offer ... and hide the
   others" test in `acs-service-setup/test/split-drivers.test.js`.
2. **The switch.** Add the protocol to `SplitDrivers` in
   `acs-service-setup/lib/split-drivers.js` if it isn't there, with its
   payload format map, and set it to `true` under
   `serviceSetup.config.splitDrivers` in `deploy/values.yaml`. Point the
   release note at "Edge charts and every split driver move" above
   rather than explaining it again, because it applies to every
   protocol, and say the move needs a major release.
3. **The whole-site test.** Copy `acs-service-setup/test/rest-move.test.js`
   and its `rest-move/` folder. `site.json` is the site before the move.
   Build its connections from the golden samples
   (`acs-edge/tests/fixtures/drivers/samples/<protocol>-*`), keeping each
   sample's devices so the harness can replay them, and include a name
   with a dot, a name with capitals, credentials as `__FPSI__`
   placeholders with their values under `secrets`, two connections on
   one agent and an agent without the protocol. Run the test with
   `UPDATE_REST_MOVE=1` (rename it for your protocol) to write
   `moved.json`, and read its diff.
4. **The harness.** Add a case to `acs-edge/tests/golden/golden.test.ts`
   like "split driver after service-setup's move" that replays your
   `moved.json`, and make your fake device's `connection()` point
   `DriverDetails` at itself as well as the built-in details key (see
   `devices/http.ts`). Add the folder to the `paths` of
   `.github/workflows/split-driver-golden.yaml` and
   `acs-edge-tests.yaml`, and grep for your cases in the golden workflow
   as it does for REST.
5. **Docs.** Add the protocol's behaviour differences to this page and a
   release-notes entry.
