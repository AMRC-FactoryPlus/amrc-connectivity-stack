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

Service-setup runs the move on every upgrade, and a second run finds
nothing to change. A run that stopped half way through is finished by
the next one.

### New connections

After the upgrade, the connection form in the Manager offers one REST
driver, called "REST", which is the split driver. The built-in driver is
called "REST (built-in)" and is shown only on a connection that still
uses it, for example on a site that has moved REST back.

## Before you upgrade

The Edge Agent and its `edge-rest` sidecar must come from the same ACS
release. Both take their image tag from the edge Helm charts that each
upgrade writes to the `shared/helm` repository on the central cluster,
and each edge cluster picks those charts up from the repository's
`main` branch within a few minutes. Check two things first:

- **Customised edge charts.** If your site has committed its own
  changes to `main` in `shared/helm`, the upgrade writes the new charts
  to the `acs` branch only and leaves `main` alone. Your edge clusters
  then keep the old charts, which ask for an `edge-rest` image with the
  old release's tag. That image doesn't exist, so the sidecars can't
  start and the moved connections get no data. Merge `acs` into `main`
  as part of the upgrade, or set `REST: null` until you have.
- **Edge clusters that can't reach the central cluster.** An edge
  cluster that can't fetch from the central git server keeps its old
  charts and deployments until it can. If its Edge Agent can still
  reach the ConfigDB, it loads the moved config and waits for a sidecar
  that hasn't arrived, so its REST devices have no data until the edge
  cluster catches up.

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
