# Split Drivers

An Edge Agent reads devices through split drivers. A split driver is a
small container (a sidecar) in the Edge Agent's pod that talks to the
device and passes what it reads to the Edge Agent over a broker inside
the pod. Modbus, BACnet, ADS and the other drivers with their own image
have always worked this way. Until ACS 7 the Edge Agent also had REST,
MQTT, OPC UA and UDP connections built into it. ACS 7 removes them, so
every protocol is deployed, versioned and fixed in the same way. Their
split drivers are `edge-rest`, `edge-mqtt`, `edge-opcua` and `edge-udp`.
The protocol between the Edge Agent and a split driver is described in
[`acs-edge/docs/edge-split.md`](../../../acs-edge/docs/edge-split.md).

The move is one way. When a site upgrades to ACS 7, service-setup moves
every built-in REST, MQTT, OPC UA and UDP connection to its split
driver, and there is no setting that moves a connection back, because
the Edge Agent has nothing left to move it back to, and going back to
version 6 is not supported. Read [Before you
upgrade](#before-you-upgrade) first.

## Before you upgrade

1. **Check whether your site has its own edge chart changes.** List the
   two branches of the chart repository, signing in as the ACS admin
   user when asked:

   ```sh
   git ls-remote https://git.<your ACS domain>/git/shared/helm refs/heads/main refs/heads/acs
   ```

   If both lines show the same commit hash, nobody has changed `main`
   and the upgrade moves it for you. If they differ, your site has its
   own changes, and its edge clusters keep running version 6 after the
   central upgrade until you merge `acs` into `main`, as [Edge
   charts](#edge-charts) explains. Choose one of these:

   - Merge straight after the upgrade. Once the service-setup Job has
     finished, merge `acs` into `main` and push it. Until you do, the
     moved connections' devices have no data, because the version 6
     charts can't start their sidecars.
   - Or hold the move until the edge is on version 7. Set each protocol
     your site uses to `hold` for this upgrade:

     ```yaml
     serviceSetup:
       config:
         splitDrivers:
           REST: hold
           MQTT: hold
           OPCUA: hold
           UDP: hold
     ```

     Service-setup leaves those connections on their built-in drivers,
     which the version 6 Edge Agents still run, so nothing stops. It
     logs a line each run starting `ERROR:
     serviceSetup.config.splitDrivers.REST is 'hold'` that counts them.
     Merge `acs` into `main` when you can. Your Edge Agents then start
     version 7, which can't run built-in connections, so the held
     connections have no data until the next step: remove the `hold`
     settings and run the upgrade again (or re-run the service-setup
     Job), which moves them. Do the two close together.
2. **Check every edge cluster is fetching from the central git server.**
   An edge cluster that can't fetch keeps the old charts, so its moved
   connections have no data until it can.
3. **Find Edge Agents that pin their own image.** In the Manager, an
   Edge Agent's Deployment that sets `image.default.tag`,
   `image.default.registry`, `image.edgeAgent.tag` or
   `image.edgeAgent.registry` keeps running that image after the
   upgrade. Its connections are not moved and keep working on the old
   Edge Agent, which still has the built-in connections. That is safe,
   but the agent isn't upgraded. To switch it over later, remove the
   setting and run the upgrade again (or re-run the service-setup Job):
   that run moves its connections, and the agent restarts on this
   release's image with its sidecars.
4. **Find Edge Agents with no Edge Agent Deployment config.** ACS
   deploys an Edge Agent from its Deployment config. One without it was
   deployed some other way, and keeps whatever image it was given, so
   service-setup leaves its connections on the built-in drivers. On a
   version 6 image they keep working. If that agent is ever given a
   version 7 image, they get no data. Don't rely on this: give each such
   agent a Deployment config, or remove it if it is no longer used,
   before you upgrade. To find them, list the objects of
   the Edge Agent config app (`aac6f843-cfee-4683-b121-6943bfdf9173`)
   and of the Edge Agent Deployment app
   (`f2b9417a-ef7f-421f-b387-bb8183a48cdb`) in the ConfigDB, for
   example with `GET /v1/app/<app>/object` on the ConfigDB service:
   every Edge Agent in the first list and not the second that has a
   REST, MQTT, OPC UA or UDP connection is one. Give it a Deployment
   config so ACS deploys it, and the next upgrade moves its connections.
5. **Find UDP connections that would share a port.** Every built-in UDP
   connection listens on port 50205, the only port the version 6 form
   allowed. In version 7 each UDP connection opens its port on the edge
   host its Edge Agent runs on, and a host can open a port once. List
   your UDP connections in the Manager with their Edge Agents, and note
   each pair whose agents are in the same cluster and either are pinned
   to the same host or have one not pinned to a host. For each such pair
   the upgrade gives the port to one connection, and the other gets no
   data until you give it another port. Plan the new port, and how to
   point the device at it, before you upgrade.
6. **Take a backup of the ConfigDB**, as before any major upgrade.

## What an upgrade does

For each built-in REST connection, service-setup:

1. changes the connection's driver to the REST split driver,
2. changes the connection's entry in its Edge Agent's config from
   `connType: REST` with `RESTConnDetails` to `connType: Driver` with
   `DriverDetails`, keeping every field (base URL, authentication,
   devices, addresses, paths and payload formats) as it was, and
3. adds an `edge-rest` sidecar for the connection to the Edge Agent's
   deployment.

MQTT, OPC UA and UDP connections move the same way, to an `edge-mqtt`,
`edge-opcua` or `edge-udp` sidecar each, with every connection detail
kept: broker, TLS, client id and credentials for MQTT, endpoint,
security and credentials for OPC UA, the port for UDP. Two more things
change for OPC UA, because its driver hands the Edge Agent JSON where
the built-in connection handed it decoded values: the connection and its
devices change from "Defined by Protocol" to JSON, and every metric path
on the connection is removed. See [What changes for an OPC UA
connection](#what-changes-for-an-opc-ua-connection). Each moved
connection keeps a note of the built-in driver and payload format it
had (`splitMigration` in its ConnectionConfiguration).

A connection whose name can't be used as a container or MQTT name (for
example one with a dot, an underscore or a space in it, such as a name
taken from a web address) is given a driver id, such as
`api-example-org-1a2b3c4d`, and its sidecar is named after that id. The
connection keeps its name everywhere else.

The Edge Agent reloads its config as soon as service-setup writes it,
and its pod restarts with the new sidecars once the edge cluster has
applied the new deployment, which normally takes a few minutes. An
upgrade already restarts every Edge Agent once for its new image, so
expect an Edge Agent with these connections to restart once or twice in
the minutes after the upgrade, and their devices to have no data for
that time.

The move runs in the service-setup Job's `split-drivers` init
container, after the `edge-helm-charts` container has published this
release's edge charts. An init container runs only once the one before
it has succeeded, so connections are never moved for charts that
weren't published. Every service-setup log line this page mentions
about the move is in that container's log.

Service-setup runs the move on every install and upgrade, so a site
that upgrades from any version 6 release, however late, is moved. A
second run finds nothing to change, and a run that stopped half way
through is finished by the next one. Once nothing uses the built-in
REST, MQTT, OPC UA and UDP drivers, service-setup deletes their
definitions, as it did for the drivers ACS 6 retired.

### Two cases the move treats differently

- **An Edge Agent that pins its own image** keeps its built-in
  connections, as step 3 of [Before you upgrade](#before-you-upgrade)
  says. A sidecar takes its image tag and registry from the same
  setting, and no split driver image exists at another release's tag or
  in a private registry, so moving the connection would stop the pod.
  The service-setup log has a line for each such connection that says
  which setting to remove.
- **An Edge Agent with no Edge Agent Deployment config** keeps its
  built-in connections, because nothing would run a sidecar for it, as
  step 4 of [Before you upgrade](#before-you-upgrade) says. The
  service-setup log has a line for each such connection starting
  `ERROR: Connection` and ending with how to fix it.
- **A UDP connection whose port another connection on the same host
  already has** is moved, but without its sidecar. The connection that
  got the port first keeps it and its data. The Edge Agent pod of the
  second still starts, and its other connections work, but its devices
  have no data. The service-setup log has a line for it on every run,
  starting `ERROR: Connection` and naming both connections and the port.
  Change the second connection's port in the Manager, save it and point
  the device at the new port: the Manager adds the sidecar, and the data
  comes back.

### The setting

`serviceSetup.config.splitDrivers` in the chart's values takes a value
for each protocol, `REST`, `MQTT`, `OPCUA` and `UDP`:

| Value | What service-setup does on every install or upgrade |
|---|---|
| not set, or `true` | Moves the protocol's connections to its split driver. |
| `hold` | Leaves them on the built-in driver, and logs an `ERROR:` line counting them. Only for a site whose Edge Agents still run version 6, as in step 1 of [Before you upgrade](#before-you-upgrade): a version 7 Edge Agent can't run them. |
| `false` | Refused, because there is no move back: it logs an `ERROR:` line and moves the connections as if it were not set. |

Use the string `hold`, not `null`. Version 6 took `null` to leave a
protocol alone, and service-setup still holds a protocol it finds set
to null, but Helm 4.0 drops a null from a site's values before
service-setup sees it, and the connections would then move. The chart's
default is `splitDrivers: {}`, with no protocol named.

`dryRun: true` logs each change service-setup would make and writes
nothing. Use it only on a test cluster: on a site, a connection a dry
run leaves on its built-in driver has no data once its Edge Agent runs
version 7.

### New connections

After the upgrade, the connection form in the Manager offers one driver
for each protocol: "REST", "MQTT", "OPC-UA" and "UDP", which are the
split drivers. A connection on an Edge Agent that pins its own image
still shows its built-in driver, such as "UDP (built-in)", until the
agent is upgraded.

## Edge charts

This applies to every protocol's move to a split driver. It is a
property of how the edge Helm charts reach edge clusters, not of any
one driver.

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

This is why step 1 of [Before you upgrade](#before-you-upgrade)
matters. If an upgrade has moved connections and your edge clusters
didn't get the new charts, the moved connections' devices have no data,
and each Edge Agent pod has a `driver-<name>` container that can't pull
its image (`ImagePullBackOff`). Merge `acs` into `main` in `shared/helm`
and push it: once you have cloned the repository, merge `origin/acs`
into `main`, keeping your own changes, and push `main`. Within a few
minutes the edge clusters run this release's images, the sidecars
start, and the data comes back. Nothing else needs doing. The
service-setup Job's `edge-helm-charts` container logs a line starting
`WARNING: branch main of shared/helm has commits of its own` whenever it
leaves `main` alone, so you can also check after the upgrade.

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
lowered the built-in connection's CPU too.

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
  Two metrics that read one node, one with a path and one without,
  had different keys in the Edge Agent's index and both updated. With
  the paths removed they have the same key, so from version 7 the
  Edge Agent updates every metric on an address and path, not only the
  last one (ACS-27).
- **Every device gets its own values.** On a connection with more than
  one device, the built-in connection gave every device's values to
  the last device's metrics, or dropped them. The driver gives each
  device its own values. So after the move, devices that published
  nothing start publishing, and the last device on such a connection
  stops publishing values that were never its own.
- **A device with nothing to read is harmless.** A device with no
  addressed metrics made the built-in connection ask the server to
  monitor nothing, and the server's refusal stopped the whole Edge
  Agent. The driver subscribes only to addresses it has, so such a
  device just births and the others carry on.
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

1. In the log of the service-setup Job's `split-drivers` container,
   find the line that starts `Split drivers:`. It gives how many connections moved, how many were
   held back by a pinned image or by an Edge Agent with no Deployment,
   how many moved without a sidecar because of a port clash, and how
   many failed. The lines above it name each
   connection, and any line starting `ERROR:` needs acting on.
2. In the Manager, open a REST, MQTT, OPC UA or UDP connection. Its
   driver is "REST", "MQTT", "OPC-UA" or "UDP".
3. On the edge cluster, each Edge Agent's pod has a running
   `driver-<name>` container for each of these connections.
4. The connections' devices are publishing data again a few minutes
   after the upgrade.

## If a connection has no data afterwards

There is no move back, so the fix is always forward. Look for the cause
in this order:

- **A `driver-<name>` container can't pull its image.** The edge cluster
  has the old charts: merge `acs` into `main` as in [Edge
  charts](#edge-charts). Setting the protocol to `hold` now doesn't
  help: it holds connections that haven't moved yet, and doesn't move
  any back.
- **The service-setup log has `ERROR: serviceSetup.config.splitDrivers.<PROTOCOL>
  is 'hold'`, and the Edge Agent runs version 7.** The held connections
  can't run on it. Remove the setting and run the upgrade again.
- **The connection has no `driver-<name>` container.** Look in the
  service-setup log for an `ERROR: Connection` line naming it. A UDP
  connection whose port another connection has needs another port, as
  in [Two cases the move treats
  differently](#two-cases-the-move-treats-differently).
- **The connection's Edge Agent has no Deployment** and runs a version
  7 image. Its connections were left on the built-in drivers, which
  that image doesn't have. Give the agent a Deployment config, as in
  step 4 of [Before you upgrade](#before-you-upgrade), or put it back
  on a version 6 image until you can.
- **The Edge Agent's log has `ERROR: Connection '<name>' was not
  started`.** The connection is still on a built-in driver, which this
  Edge Agent doesn't have. Its Node also raises the alert
  `Alerts/Connection/<name>` ("Edge Agent: Connection problem"), so it
  shows without reading the log. The log line says what to do: find why
  service-setup left it (a dry run, a failed move, or a config written by
  hand), and either upgrade again so service-setup moves it, or open the
  connection in the Manager, pick its split driver and save it.
- **The container is running but the devices have no data.** Read the
  container's log. Each driver logs why it can't reach its device. Then
  read the protocol's "What changes" section above.

## Rolling back to version 6

Going back to version 6 after upgrading to version 7 is not supported.
Fix forward instead, as in [If a connection has no data
afterwards](#if-a-connection-has-no-data-afterwards).

## For developers

The golden-output harness (`acs-edge/tests/golden`) proves each split
driver makes the Edge Agent publish what the built-in connection did. It
compares against runs of the built-in connections recorded before ACS 7
removed them, and its README says what to do now that they can't be
recorded again. The whole-site move tests in `acs-service-setup/test/`
(`rest-move`, `mqtt-move`, `udp-move`, `opcua-move`) check the move
gives exactly the configs in their `moved.json`, which the harness
replays through the split drivers.
