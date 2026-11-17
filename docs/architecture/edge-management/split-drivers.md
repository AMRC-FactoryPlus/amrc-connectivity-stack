# Split Drivers

An Edge Agent reads devices in one of two ways. Some protocols are built
into the Edge Agent itself. Others run as a split driver, which is a
small container (a sidecar) in the Edge Agent's pod that talks to the
device and passes what it reads to the Edge Agent over a broker inside
the pod. Modbus, BACnet, ADS and the other drivers with their own image
have always worked this way. The built-in REST, MQTT, OPC UA and UDP
connections are moving to split drivers so that every protocol is
deployed, versioned and fixed in the same way. The protocol between the
Edge Agent and a split driver is described in
[`acs-edge/docs/edge-split.md`](../../../acs-edge/docs/edge-split.md).

REST, MQTT, OPC UA and UDP move in version 7. Their split drivers are
`edge-rest`, `edge-mqtt`, `edge-opcua` and `edge-udp`.

## The setting

The ACS chart moves connections between a built-in connection and its
split driver with `serviceSetup.config.splitDrivers` in its values:

```yaml
serviceSetup:
  config:
    splitDrivers:
      REST: true      # the chart's default
      MQTT: true      # the chart's default
      OPCUA: true     # the chart's default
      UDP: true       # the chart's default
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
`REST: null`, and likewise for MQTT. With `dryRun: true`, service-setup logs each change it
would make and writes nothing, which is a safe way to see what an
upgrade will do before you make it.

## What an upgrade does

For each built-in REST or MQTT connection, service-setup:

1. changes the connection's driver to the protocol's split driver;
2. changes the connection's entry in its Edge Agent's config from
   `connType: REST` with `RESTConnDetails`, or `connType: MQTT` with
   `MQTTConnDetails`, to `connType: Driver` with `DriverDetails`,
   keeping every field as it was: for REST the base URL and
   authentication, for MQTT the host, port, protocol, TLS, username,
   password, client id, keep-alive and clean session, and for both the
   devices, addresses, paths and payload formats;
3. adds an `edge-rest` or `edge-mqtt` sidecar for the connection to the
   Edge Agent's deployment.

A connection whose name can't be used as a container or MQTT name (for
example one with a dot, an underscore or a space in it, such as a name
taken from a web address) is given a driver id, such as
`api-example-org-1a2b3c4d`, and its sidecar is named after that id. The
connection keeps its name everywhere else.

The Edge Agent reloads its config as soon as service-setup writes it,
and its pod restarts with the new sidecar once the edge cluster has
applied the new deployment, which normally takes a few minutes. An
upgrade already restarts every Edge Agent once for its new image, so
expect an Edge Agent with REST or MQTT connections to restart once or
twice in the minutes after the upgrade, and those devices to have no
data for that time. An MQTT connection with a fixed client id and clean
session off has a persistent session on its broker, which the split
driver takes over because it connects with the same client id.

Built-in UDP connections move the same way, to an `edge-udp` sidecar
each, with `UDPConnDetails` becoming `DriverDetails` and the port kept.
Each sidecar also opens the connection's port on the edge host its Edge
Agent runs on (a Kubernetes `hostPort`), and a host can open each port
once. So before it moves a UDP connection, service-setup checks its
port against every connection that already opens one, with the rule the
Manager uses when you save a connection: two connections clash if they
are in the same cluster and either their Edge Agents are pinned to the
same host or either agent is not pinned. Where an agent runs comes from
its Edge Agent Deployment. A connection that would clash is not moved:
it stays on the built-in connection, keeps working as before, and the
log has a line for it ending `Give one of them another port`. Every
built-in UDP connection uses port 50205, because that was the only port
the old form allowed, so on a site where two of them can land on one
host, only the first moves. Give the one that moved another port in the
Manager (and point its device at it) and the next run moves the other.

Built-in OPC UA connections move the same way, to an `edge-opcua`
sidecar each, with `OPCUAConnDetails` becoming `DriverDetails` and every
field kept: endpoint, security mode and policy, credentials and the
password's secret. Two more things change for OPC UA, because the
driver hands the Edge Agent JSON where the built-in connection handed
it decoded values: the connection and its devices change from "Defined
by Protocol" to JSON, and every metric path on the connection is
removed. See [What changes for an OPC UA
connection](#what-changes-for-an-opc-ua-connection).

Service-setup runs the move on every install and upgrade, and a second
run finds nothing to change. A run that stopped half way through is
finished by the next one.

### New connections

After the upgrade, the connection form in the Manager offers one REST
driver, called "REST", one MQTT driver, called "MQTT", one OPC UA
driver, called "OPC-UA", and one UDP driver, called "UDP", which are
the split drivers. The built-in drivers are called "REST (built-in)",
"MQTT (built-in)", "OPC-UA (built-in)" and "UDP (built-in)" and are
shown only on a connection that still uses one, for example on a site
that has moved a protocol back.

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
4. **Remove any image pin from your Edge Agents.** A sidecar's image is
   its repository with the tag and registry from `image.default` in the
   Edge Agent Deployment's values, so for an Edge Agent whose Deployment
   sets its own tag or registry (under `image.default` or
   `image.edgeAgent`) no split driver image exists. Service-setup
   doesn't move that agent's connections: it counts them as held back
   and logs a line for each that says `not moving to the split driver`
   and names the setting. Remove the setting and the next upgrade moves
   them.

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

## What changes for an MQTT connection

`edge-mqtt` subscribes to the same topics with the same connection
details as the built-in connection and hands the Edge Agent each
message's payload unchanged, so the Edge Agent reads it with the same
payload format and metric paths, and the data your devices publish
doesn't change. That holds for every payload format (JSON,
JSON (Batched), XML, Delimited String and Buffer) and for wildcard
topics. Its full behaviour is in
[`edge-mqtt/README.md`](../../../edge-mqtt/README.md). You may notice
these differences:

- **A lost broker takes the devices offline.** While the driver can't
  reach the broker, or the broker refuses its username or password, the
  connection's devices are marked offline, and they come back when it
  reconnects. The driver tries again every 10 seconds, as the built-in
  connection did. The built-in connection left its devices online while
  its broker was away, so their last values looked current.
- **Writes publish the value as text.** A write to an MQTT metric
  publishes the value alone (`21.5`, `true`) to the metric's topic. The
  built-in connection built the message from the device's payload
  format and the metric's path. If anything you run writes to MQTT
  metrics, check it accepts the plain value.
- **Very large messages are dropped.** A message larger than about
  16 MB is dropped with a warning in the driver's log.
- **Shared topics stay subscribed.** When a device is removed, a topic
  another device on the connection still reads stays subscribed. The
  built-in connection unsubscribed it, which stopped the other device's
  data until the agent restarted.
- **Certificates are checked as before.** Over TLS the broker's
  certificate must be signed by a well-known certificate authority, as
  with the built-in connection, so a broker with a self-signed
  certificate is still refused.
- **A little more CPU in the pod.** The Edge Agent uses about the same
  CPU as with the built-in connection, and the driver container adds 1
  to 3% of a core. See "CPU" below.
- **One more container per connection.** Each MQTT connection runs in
  its own `edge-mqtt` container in the Edge Agent's pod.

### CPU

The Edge Agent and `edge-mqtt` were measured against the built-in
connection on a connection shaped like the busiest MQTT connection in
use: 7 devices, 2,721 metrics and 112 topics of JSON, with messages
from a separate broker at 123, 370 and 1,232 messages a second.

| Messages a second | Edge Agent, built-in | Edge Agent, split | `edge-mqtt` |
|---|---|---|---|
| 123 | 7 to 8% of a core | 7 to 9% | 1% |
| 370 | 12% | 14 to 15% | 1 to 2% |
| 1,232 | 30 to 35% | 34 to 35% | 2 to 3% |

`edge-mqtt` uses about 5 MB of memory, whatever the number of metrics.
No message was lost or reordered. Before version 7 the Edge Agent ran
each device's poll timer every millisecond when the connection had no
poll interval, which is every MQTT connection, and with a split driver
each tick sent the driver a poll it had nothing to do with. That more
than doubled the Edge Agent's CPU at 123 messages a second (21 to 24%,
against 9 to 10% for the built-in connection, which also paid for the
timer). A device with no poll interval now has no poll timer, which
lowers the built-in connection's CPU too.

## What changes for a UDP connection

`edge-udp` hands the Edge Agent each datagram as it arrived, as the
built-in connection did, and the Edge Agent reads it with the device's
payload format (JSON, Buffer or Delimited String), so the data your
devices publish doesn't change. Its full behaviour is in
[`edge-udp/README.md`](../../../edge-udp/README.md). You may notice
these differences:

- **The port opens on the edge host.** A device outside the cluster can
  now send to the host's address on the connection's port, which it
  couldn't with the built-in connection. The port must be free on the
  host, and the host's firewall must let UDP in on it.
  [Connecting a UDP device](../../services/udp-devices.md) covers the
  address to send to, the firewall and network policy rules, and
  pinning.
- **Pinning isn't checked by the move.** On a cluster with more than one
  host, a device outside the cluster needs the Edge Agent pinned to one
  host. The Manager asks for that when you save a UDP connection, but
  the move does not, so pin the agent with **Move** on the node's page.
- **The port can be changed.** The split driver's form takes any port
  from 1 to 65535, where the built-in form only took 50205.
- **Metric addresses stay empty.** Every datagram goes to the empty
  address, as before, so a metric with an address never gets a value.
  The form now labels the field "Address (leave empty)".
- **Writes are refused.** A write to a UDP metric is answered as failed.
  The built-in connection ignored it and never answered.
- **Drops are counted.** The driver asks for a bigger receive buffer
  and logs a warning every 10 seconds in which datagrams were lost,
  saying where. Raising `net.core.rmem_max` on the host lets fast
  devices use the bigger buffer.
- **One more container per connection.** Each UDP connection runs in
  its own `edge-udp` container in the Edge Agent's pod.

## What changes for an OPC UA connection

`edge-opcua` subscribes to the same nodes with the same settings as the
built-in connection, and for one device the Edge Agent publishes the
same values, with the same Sparkplug types, as before. Both stamp each
value with the time it arrived, not the server's timestamp. Its full
behaviour is in [`edge-opcua/README.md`](../../../edge-opcua/README.md).
You may notice these differences:

- **The payload format is JSON.** The connection and its devices change
  from "Defined by Protocol" to JSON, which is what the driver sends. A
  connection with no format of its own gets JSON too.
- **Metric paths are removed.** The built-in connection never read a
  metric's path, so some metrics have something in the field that was
  never meant as a path, such as a unit (`mm`). The Edge Agent reads
  the driver's JSON through a metric's path, so such a metric would
  never update. The move removes every path on the connection's
  metrics in the Edge Agent config, and the Manager leaves them out
  when it rebuilds the config of a connection on the split driver (its
  DriverDef has `metricPaths: false`). Each device's origin map keeps
  its paths. The `path` property is gone from these metrics in DBIRTH.
  The Manager's form hides the path field for OPC UA, as it did before.
- **Every device gets its own values.** On a connection with more than
  one device, the built-in connection gave every device's values to
  the last device's metrics, or dropped them. The driver gives each
  device its own values. So after the move, devices that published
  nothing start publishing, and the last device on such a connection
  stops publishing values that were never its own.
- **DateTime metrics publish the date.** The built-in connection
  published every DateTime value as 0.
- **An unreachable server shows.** The devices go offline while their
  server can't be reached, and send a new DBIRTH when it is back. The
  built-in connection left them online with their last values.
- **A few more DDATA messages.** The Edge Agent groups the values the
  driver sends together into one DDATA per device, but some of a
  notification's values reach it a little late and go out in a second
  message, so a device sends up to two DDATA messages for each
  notification where the built-in connection sent one. The values and
  timestamps are the same.
- **Writes are confirmed.** A write shows as written only once the
  server accepts it, and one the server refuses is answered as failed.
- **Certificates.** Like the built-in connection, the driver makes a
  self-signed client certificate when its container starts, with the
  same application URI. The built-in connection kept its certificate in
  a folder that every new Edge Agent pod starts without, so a secured
  server already accepts a new client certificate after every upgrade,
  and it accepts the driver's in the same way. Both accept any server
  certificate.
- **One more container per connection.** Each OPC UA connection runs in
  its own `edge-opcua` container in the Edge Agent's pod.

## Checking it worked

1. In the service-setup Job's log, find the line that starts
   `Split drivers:`. It gives how many connections moved, how many
   were held back and how many failed, and the lines above it name each
   connection and say why it was held back.
2. In the Manager, open a moved connection. Its driver is "REST",
   "MQTT", "OPC-UA" or "UDP".
3. On the edge cluster, the Edge Agent's pod has a `driver-<name>`
   container for each moved connection, and each is
   running.
4. The connection's devices are publishing data again a few minutes
   after the upgrade.

## Moving back

Set `REST: false`, `MQTT: false` or `UDP: false` under
`serviceSetup.config.splitDrivers` in your values and upgrade.
Service-setup moves every connection of that protocol back to the
built-in connection, removes its sidecar, and leaves each connection's
config, and its Edge Agent's deployment, exactly as they were before
the move. A connection created in the Manager after the move uses the
split driver, and the next upgrade with the protocol set to `false`
moves it to the built-in connection too. `UDP: false` also closes the
UDP ports on the edge hosts. A UDP connection that was given a port
other than 50205 after the move keeps it, and the built-in connection
listens on it inside the pod.

`OPCUA: false` moves OPC UA connections back in the same way, and their
payload format back to "Defined by Protocol" (also on a connection that
had no format of its own before the move, which now names it). The
metric paths the move removed are not put back, because the built-in
connection never read them. The Manager puts them back from each
device's origin map the next time it saves the device or connection.

## Adding a protocol's migration

This is for developers moving another built-in protocol (UDP, OPC UA)
to its split driver. Follow what REST and MQTT did:

1. **DriverDefs.** In `acs-service-setup/dumps/edge.yaml`, the split
   DriverDef already exists and is hidden. Remove its `hidden`, name it
   plainly (for example "MQTT"), and hide the built-in and name it
   "MQTT (built-in)". Both changes are needed, because the connection
   form picks drivers by name. Update the "offer ... and hide the
   others" test in `acs-service-setup/test/split-drivers.test.js`. If
   the driver's values leave nothing for a metric path to select, give
   its DriverDef `metricPaths: false`, as OPC UA's has: the move then
   removes paths and the Manager leaves them out.
2. **The switch.** Add the protocol to `SplitDrivers` in
   `acs-service-setup/lib/split-drivers.js` if it isn't there, with its
   payload format map, and set it to `true` under
   `serviceSetup.config.splitDrivers` in `deploy/values.yaml`. A
   split DriverDef with `hostPorts` gets the host port check without
   anything to add. Point the
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
   `devices/http.ts`). A fake device can check credentials and security
   when the run asks it to (`secure`, see `devices/opcua.ts`), and a run
   can send writes (`commands`). Where the built-in connection is wrong,
   compare against a reference that is right, as the OPC UA case does
   with one device at a time (`merge_runs`). Add the folder to the `paths` of
   `.github/workflows/split-driver-golden.yaml` and
   `acs-edge-tests.yaml`, and grep for your cases in the golden workflow
   as it does for REST.
5. **Docs.** Add the protocol's behaviour differences to this page and a
   release-notes entry.
