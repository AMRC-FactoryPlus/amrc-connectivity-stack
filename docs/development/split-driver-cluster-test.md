# Split-Driver Cluster Test

This is the runbook for proving ACS version 7's split drivers on a dev
cluster before any production cluster is upgraded. Version 7 moves the
Edge Agent's built-in REST, MQTT, OPC UA and UDP connections into split
drivers (sidecar containers in the Edge Agent's pod). The test puts
mock devices shaped like a real site's connections on a dev cluster,
loads Edge Agent connections that read them in their built-in form
(the state a site is in today), records what the Edge Agents publish,
upgrades to a test build of version 7, records again and compares.

The tools are in [`acs-edge/tests/rig/`](../../acs-edge/tests/rig/).
Everything that names a real site (the connection configs, the rig
made from them and the recordings) stays in a private folder outside
this repository.

Every command that changes the cluster is one you run. Nothing in the
rig changes a cluster by itself: the loader and the remover print what
they would do until you add `--yes`.

## What the test must show

From the epic's cluster test card (ACS-47):

1. Upgrading from the current release to a build of
   `feature/split-drivers`, with built-in REST, MQTT, OPC UA and UDP
   connections present and publishing, works.
2. After the upgrade each connection has moved to its split driver, its
   sidecar is running, and its devices publish the same metrics as
   before, with no gap longer than one restart.
3. There is no move back (decided 2026-11-17): a version 6
   `splitDrivers.<PROTO>: false` is refused with an `ERROR` line in the
   service-setup log, and the connections still move. `hold` holds a
   protocol's not-yet-moved connections on the built-in drivers, with
   an `ERROR` line counting them, for a site whose edge still runs
   version 6. It moves nothing back.
   An Edge Agent with no Edge Agent Deployment config keeps its
   built-in connections, with an `ERROR: Connection` line each in the
   service-setup log, and they keep publishing while that agent runs a
   version 6 image.
4. Connections with dotted names work. A UDP sender outside the
   cluster reaches the driver on the host port. OPC UA writes work. A
   device goes offline when its server or broker is stopped and comes
   back when it returns.
5. The CPU and memory of each Edge Agent and sidecar, before and after.
6. Each protocol's own checks, collected in [Protocol
   checks](#protocol-checks) below.

## What the rig is

| Part | Command | What it does |
|---|---|---|
| Generator | `rig make-rig` | Reads connection configs exported from a site (passwords redacted) and writes a rig: one Edge Agent per source Edge Agent, one connection per source connection, a mock port for each, made-up passwords, the Kubernetes manifests for the mocks, and a coverage report. |
| Mocks | `rig run-mocks` | One pod per protocol. Each connection gets its own mock: an OPC UA server with the same node ids, data types, security mode, policy and login; an HTTP server answering the same paths with JSON or XML of the same shape; an MQTT broker of its own with a publisher sending the same topics and payload shapes. Values come from the driver fixture generator and change all the time. A UDP sender runs outside the cluster, as a real device would. |
| Loader | `rig load` | Creates the rig's Edge Agents, connections and devices through ConfigDB with the writes the Manager makes, in their built-in form. |
| Checker | `rig check` | Records the rig's Sparkplug output and compares two recordings. Read-only. |
| Writer | `rig write` | Sends one metric write through the Command Escalation service, for the OPC UA write check. |
| Remover | `rig remove` | Deletes everything the loader made. |
| Local runner | `rig local` | Runs mocks, real Edge Agents and the split drivers on one machine, for proving the rig before it goes on a cluster. |

All of them are in one image, `acs-rig-mocks`, built from this
repository. It is test support and is not published with ACS.

### What the rig changes from the source configs

A connection keeps its devices, metrics, addresses, paths, payload
formats, poll interval, OPC UA security mode and policy, and whether
it logs in. The rig changes only:

- the address it connects to (the mock), and its name, which gets the
  rig's prefix (`Rig-`) in front so the rig's objects are easy to find;
- passwords, which are made up when the rig is made;
- MQTT over TLS and HTTPS, which become plain MQTT and HTTP, because
  the Edge Agent would not trust a mock's certificate. The rig cannot
  test TLS. `coverage.md` lists every connection this applies to.

### What the rig cannot show

- Real device timing, real payloads and server quirks. The fixtures
  README in `acs-edge/tests/fixtures/drivers/` explains this.
- TLS, as above.
- Whether a real OPC UA server trusts the split driver's new client
  certificate. The mocks trust every certificate. The built-in already
  presented a new certificate from every new pod, so this is expected
  to work (see ACS-27, PR 911).
- MQTT brokers shared between connections. Each rig connection has a
  broker of its own.

## Before you start

You need:

- the dev cluster's kubeconfig, and ACS admin credentials on it;
- Docker on your machine, and SSH with sudo to the dev cluster's node
  (to load the mock image into k3s);
- the private folder with the connection configs and the rigs made
  from them;
- for the upgrade, permission to publish a pre-release of this
  repository (see [Making a Release](./releasing.md)).

Set these in every terminal you use. Replace the parts in angle
brackets.

```sh
export KUBECONFIG=<path to the dev cluster's kubeconfig>
export ACS_DOMAIN=<the dev cluster's ACS domain>
export RIG=<private folder>/rig/full          # or rig/subset, see "Full rig or subset"
export EDGE_NS=<the edge cluster's namespace>
export DIRECTORY_URL=http://directory.$ACS_DOMAIN
export SERVICE_USERNAME=admin
export SERVICE_PASSWORD="$(kubectl -n factory-plus get secret admin-password -o jsonpath='{.data.password}' | base64 -d)"
alias rig='docker run --rm -e DIRECTORY_URL -e SERVICE_USERNAME -e SERVICE_PASSWORD -e MQTT_URL -v "$RIG":/rig acs-rig-mocks:dev'
```

The `rig` alias runs the image on your machine with the rig folder at
`/rig`. If the cluster is only reachable on a VPN, connect first. Use
`https://` in `DIRECTORY_URL` if the cluster serves HTTPS.

### Full rig or subset

Use the full rig: one Edge Agent for every source Edge Agent and one
connection for every source connection. The subset (a list of source
configs in a file) is the fallback for a cluster with too little room,
and still covers every feature `coverage.md` lists.

Each rig Edge Agent's own Deployment values ask for 50m of CPU, half
the Edge Agent chart's default, because rig agents read mocks and sit
mostly idle, and the chart's defaults for real sites don't change. A
request is not a limit, so an agent that needs more CPU still gets it
when the node has it to spare. Memory stays at the chart's 200 MiB,
except 512 MiB for the two agents with over 1,000 metrics, which used
about 300 MiB in a local run. The first lines of `coverage.md` give
the rig's total requests.

Check the cluster has room before step 3:

```sh
kubectl describe nodes | grep -A8 "Allocated resources"
kubectl get nodes -o custom-columns=NAME:.metadata.name,CPU:.status.allocatable.cpu,MEMORY:.status.allocatable.memory
kubectl top nodes
```

Subtract each node's `cpu` and `memory` Requests from what it has
allocatable. The full rig needs 1,510m CPU and 7,320 MiB (Edge Agents
1,450m and 6,424 MiB, mock pods 60m and 896 MiB). On the dev cluster
this was written for (4 CPU, 15,993 MiB allocatable, 915m CPU and
1,748 MiB already requested), that leaves 1,575m CPU and 6,925 MiB
free to request, where the chart's defaults would have left 125m. The
upgrade itself asks for almost nothing more: the central services
request no CPU apart from InfluxDB, which is already counted, and Edge
Agents restart one pod at a time (`Recreate`), so no extra pod waits
beside an old one. Actual use: the dev cluster used 371m CPU and
6,556 MiB before the rig, and the whole rig run as one local process
used 0.6 to 1.1 CPU and 850 MiB, so expect roughly 1.5 to 2 CPU and
11 GiB in use with the rig running.

**How to tell it doesn't fit.** A pod that doesn't fit stays
`Pending`. After steps 3 and 4, and after the upgrade:

```sh
kubectl get pods -A --field-selector=status.phase=Pending
kubectl describe pod -n <namespace> <pod> | sed -n '/^Events:/,$p'
```

`0/1 nodes are available: 1 Insufficient cpu` (or `memory`) means the
node is full. Then remove the full rig (step 11), set
`RIG=<private folder>/rig/subset`, and start again at step 3. A pod
that is `Pending` for another reason (an image it can't pull, a
volume) shows that reason instead, and the subset won't help.

## The steps

Times are for a single-node dev cluster. The longest wait is the test
build.

| Step | What | Time |
|---|---|---|
| 1 | Check the cluster | 5 min |
| 2 | Build the image and load it into k3s | 15 to 20 min |
| 3 | Start the mocks | 5 min |
| 4 | Load the built-in connections | 10 min |
| 5 | Record the before state | 20 min |
| 6 | Make a test build | 60 min, unattended |
| 7 | The ACS-35 change, then upgrade | 30 min, with a recording running across it |
| 8 | Record the after state and compare | 20 min |
| 9 | The specific checks | 45 min |
| 10 | Check a version 6 `false` is refused | 15 min |
| 11 | Clean up | 10 min |

### 1. Check the cluster

1. Check nothing has committed to the edge Helm charts' `main`. Version
   7 needs the edge clusters to get the new charts, see "Edge charts
   and every split driver move" in
   [Split Drivers](../architecture/edge-management/split-drivers.md).

   ```sh
   git ls-remote http://git.$ACS_DOMAIN/git/shared/helm refs/heads/main refs/heads/acs
   ```

   You should see the same commit hash on both lines. If they differ,
   merge `acs` into `main` straight after the upgrade in step 7, or the
   moved connections get no data.

2. Check no Edge Agent Deployment pins its own image (`values.image`),
   because a pinned agent's sidecars would use an image that doesn't
   exist:

   ```sh
   kubectl get helmrelease -n $EDGE_NS -o json | jq -r '.items[] | [.metadata.name, (.spec.values.image // "none" | tostring)] | @tsv'
   ```

   You should see `none` for every Edge Agent.

3. Note what already runs, so you can check later that the rig didn't
   disturb it:

   ```sh
   kubectl get pods -n $EDGE_NS -o wide
   ```

### 2. Build the image and load it into k3s

From the root of this repository, on the commit you are testing:

1. Build the image for your machine, which runs the loader, checker
   and UDP sender:

   ```sh
   docker build -f acs-edge/tests/rig/Dockerfile -t acs-rig-mocks:dev .
   ```

2. Build it for the cluster's nodes (`amd64` here; the build runs under
   emulation on an Apple silicon Mac and takes about 10 minutes):

   ```sh
   docker buildx build --platform linux/amd64 -f acs-edge/tests/rig/Dockerfile -t acs-rig-mocks:amd64 --load .
   ```

3. Load it into k3s on each node that will run the mocks:

   ```sh
   docker save acs-rig-mocks:amd64 | ssh <user>@<node> sudo k3s ctr images import -
   ```

   You should see `unpacking docker.io/library/acs-rig-mocks:amd64`.
   Check with:

   ```sh
   ssh <user>@<node> sudo k3s ctr images ls | grep acs-rig-mocks
   ```

If the cluster can pull from a registry you can push to, push the
image there instead and make the rig with `--image <that reference>`.

### 3. Start the mocks

The rigs in the private folder are already made. To make one again,
for example after the configs change:

```sh
docker run --rm -v <private folder>:/p acs-rig-mocks:dev make-rig /p/rig/full /p/configs /p/rig/udp-example.json --image acs-rig-mocks:amd64 --batched <busiest MQTT config name> --pin-tag <the cluster's ACS version, e.g. v6.24.0>
```

For the subset, use `/p/rig/subset` and add `--subset /p/rig/subset.txt`.
`--batched` names the config shaped like the busiest production agent
(see "The ACS-35 change" in step 7): its `$.value` topics publish
arrays, and its Edge Agent pins its image to `--pin-tag`, as the real
one does.

Making a rig again gives new passwords, so load the connections again
after it (step 4).

1. Start the mocks:

   ```sh
   kubectl apply -f "$RIG/mocks.yaml"
   ```

   This creates the namespace `acs-rig`, a Secret holding the rig, and
   one Deployment and Service per protocol.

2. Wait for them:

   ```sh
   kubectl -n acs-rig rollout status deploy --timeout=5m
   kubectl -n acs-rig logs deploy/rig-mqtt | tail
   ```

   Each mock logs `Started <id> on port <port>`, and the last line is
   `<n> <protocol> mocks running`. A pod with the heavy MQTT
   connections takes up to a minute to make its data.

3. Keep a port open to each pod's control API in a spare terminal.
   You need it for the offline, reconnect and write checks:

   ```sh
   kubectl -n acs-rig port-forward svc/rig-opcua 9001:9000 &
   kubectl -n acs-rig port-forward svc/rig-mqtt 9002:9000 &
   kubectl -n acs-rig port-forward svc/rig-rest 9003:9000 &
   curl -s localhost:9001/status | jq -c '.[] | {id, clients, delivered}'
   ```

**If it fails.** A pod stuck in `Pending` doesn't fit: see "How to tell it
doesn't fit" above. `ErrImageNeverPulled` or `ImagePullBackOff` means the
image is not on the node: repeat step 2.3 on that node. A pod that
restarts with `OOMKilled` needs more memory: the manifests ask for no
limit, so check the node is not out of memory. A mock that logs
`EADDRINUSE` has two connections on one port, which means the rig file
was edited by hand: make it again.

### 4. Load the built-in connections

1. See what the loader would write:

   ```sh
   rig load --rig /rig/rig.json
   ```

   It prints the edge cluster and Edge Agent chart it found, then for
   each rig Edge Agent the objects and configs it would create, and
   ends `<n> writes would be made (dry run: rerun with --yes)`. If the
   cluster has more than one edge cluster it stops and lists them: add
   `--cluster <uuid>`.

2. Load them:

   ```sh
   rig load --rig /rig/rig.json --yes
   ```

   About a minute. Running it again is safe: it finds the same
   objects, rewrites the same values, and leaves alone anything the
   upgrade has moved.

   Each device gets the origin map the Manager would have saved for it,
   rebuilt from its tags. The upgrade's ISA-95 placement step places
   each device from the hierarchy in that map, so its
   `Device_Information/ISA95_Hierarchy` metrics are the same after.
   A rig loaded by an older loader had no origin maps, and the upgrade
   placed all its devices at the organisation. Placements are never
   replaced, so remove that rig with `rig remove --rig /rig/rig.json --yes` (which now
   deletes the placements too) and load it again before the next run.

3. Wait for the Edge Agents. The edge cluster deploys each one within a
   few minutes:

   ```sh
   kubectl get pods -n $EDGE_NS -l factory-plus.app=edge-agent -w
   ```

   You should see one `edge-agent-rig-...` pod per rig Edge Agent,
   `1/1 Running`. Before the upgrade they have no sidecars, because
   every connection is built in. The one Edge Agent made with
   `--batched` runs the pinned image:

   ```sh
   kubectl get helmrelease -n $EDGE_NS -o json | jq -r '.items[] | select(.spec.values.image) | [.spec.values.name, (.spec.values.image | tostring)] | @tsv'
   ```

   That should print exactly one line, that agent with
   `{"default":{"tag":"<pin tag>"}}`.

   Then restart any rig Edge Agent that started before its sealed
   passwords reached the cluster. Such an agent logs
   `Error reading secret ... ENOENT` once at startup, never tries
   again, and never connects, so its mocks show `clients` of 0. The
   loader seals the passwords and creates the agents in the same run,
   and an agent can start first. To find and restart them:

   ```sh
   for p in $(kubectl get pods -n $EDGE_NS -l factory-plus.app=edge-agent -o name | grep edge-agent-rig-); do
     kubectl logs -n $EDGE_NS $p | grep -q 'Error reading secret' && echo $p
   done
   kubectl delete -n $EDGE_NS <each pod printed>
   ```

   The new pods read the passwords. The first run on the dev cluster
   needed this for 3 of the 29 agents.

4. Check the mocks have clients:

   ```sh
   curl -s localhost:9001/status | jq -c '.[] | {id, name, clients, refused}'
   ```

   Every OPC UA and MQTT mock should have `clients` of 1 or more and
   `refused` of 0. REST mocks count requests in `delivered`.

5. Start the UDP sender on your machine, outside the cluster, sending
   to the edge node's address. Leave it running for the rest of the
   test:

   ```sh
   docker run --rm --name rig-udp -v "$RIG":/rig acs-rig-mocks:dev run-mocks --rig /rig/rig.json --protocol UDP --udp-target <edge node address> --control-port 9004
   ```

   Before the upgrade the built-in UDP connection listens inside the
   Edge Agent's pod, which nothing outside the cluster can reach, so
   its device publishes no data until the move opens the host port.
   That is expected. No site has a UDP connection today.

**If it fails.** `401` from the loader means the credentials are wrong
or the variables are not exported. An Edge Agent pod in
`CrashLoopBackOff` needs its log
(`kubectl logs -n $EDGE_NS <pod> --previous`). Two source OPC UA
connections have a device with no addresses, and the built-in connection
crashes the whole Edge Agent on it (`BadNothingToDo`): those two agents
crash-loop before the upgrade, which is the finding, so note it and
carry on. An Edge Agent pod stuck in `Pending` doesn't fit: see "How to
tell it doesn't fit". A mock with `refused` above 0 is being sent the wrong
password: run `rig load --yes` again, which reseals it. A mock with
`clients` and `refused` both 0 has an agent that never connected: look
for `Error reading secret` in that agent's log and restart it (step 4.3).

### 5. Record the before state

1. Record for 15 minutes:

   ```sh
   rig check record --rig /rig/rig.json --seconds 900 --label before --rebirth --out /rig/before.json
   ```

   `--rebirth` asks each rig Edge Agent to send its births again at the
   start, as the Manager's Rebirth button does, so the checker learns
   every metric's name. It is the only thing the checker sends. If the
   checker can't reach the broker, set `MQTT_URL` to the broker's
   address from your machine (for example `mqtt://mqtt.$ACS_DOMAIN`)
   and run it again.

   At the end it prints one line per device:

   ```
   Rig_Example/Device_1 [MQTT Rig-example]: 16 metrics born, 12/12 read metrics got values, 12 changed, 0.98 DDATA/s, longest gap 1.1 s, 1 DBIRTH, 0 DDEATH
   ```

   Every device should be born, and most read metrics should get
   values. Read metrics that get none are the fixture's findings (see
   `coverage.md`) or the built-in connection's own bugs: on a
   multi-device OPC UA connection the built-in connection gives values
   only to the last device.

2. Take the resource baseline:

   ```sh
   kubectl top pods -n $EDGE_NS --containers | tee "$RIG/top-before.txt"
   kubectl top pods -n acs-rig --containers
   ```

### 6. Make a test build

A test build is a pre-release of the branch, as
[Making a Release](./releasing.md) describes under "Test builds of a
branch". It builds every image and publishes the Helm chart at that
version.

1. Check every protocol's PRs are merged into `feature/split-drivers`
   (see [Protocol checks](#protocol-checks)). A protocol whose move is
   not merged stays built in after the upgrade.

2. Publish it, with the next free number in place of `N`:

   ```sh
   git fetch origin --tags
   sha=$(git rev-parse origin/feature/split-drivers)
   gh release create v7.0.0-dev.N --target "$sha" --prerelease --title "v7.0.0-dev.N" --notes "Test build of feature/split-drivers for the dev-cluster test. Not for production."
   ```

3. Wait for the `Choose release type` run and the publish jobs it
   starts:

   ```sh
   gh run list --workflow release.yaml --limit 1
   gh run watch <run id>
   ```

   About an hour. When it is green, the images
   `ghcr.io/amrc-factoryplus/<image>:v7.0.0-dev.N` exist, including
   `edge-rest`, `edge-mqtt`, `edge-udp` and `edge-opcua`.

**If it fails.** A failed image job leaves the release without that
image. Fix it on the branch and publish the next number. Don't reuse a
tag.

### 7. Upgrade

1. In a second terminal, start a recording that runs across the whole
   upgrade:

   ```sh
   rig check record --rig /rig/rig.json --seconds 2700 --label upgrade --out /rig/upgrade.json
   ```

2. Make the ACS-35 change on the connection shaped like the busiest
   production one. See "The ACS-35 change" below for what this proves
   and what to expect.

   ```sh
   rig batched --rig /rig/rig.json --connection <its id, from coverage.md: the one with mqtt:array-topics>
   rig batched --rig /rig/rig.json --connection <the same id> --yes
   ```

   The first prints the three writes: the connection's payload format
   to `JSON (Batched)` in its connection config, the same in its Edge
   Agent config for the connection and every device, and the image pin
   removed from its Edge Agent's Deployment. The second makes them. The
   Edge Agent reloads its config at once, and its pod restarts on the
   chart's image within a few minutes:

   ```sh
   kubectl get helmrelease -n $EDGE_NS -o json | jq -r '.items[] | select(.spec.values.image) | .spec.values.name'
   ```

   prints nothing once the pin is gone. Wait 5 minutes, then go on.

3. Upgrade:

   ```sh
   helm repo update amrc-connectivity-stack
   helm upgrade acs amrc-connectivity-stack/amrc-connectivity-stack -n factory-plus --version 7.0.0-dev.N --reset-then-reuse-values --set serviceSetup.config.splitDrivers.REST=true --set serviceSetup.config.splitDrivers.MQTT=true --set serviceSetup.config.splitDrivers.OPCUA=true --set serviceSetup.config.splitDrivers.UDP=true
   ```

   `--reset-then-reuse-values` takes the new chart's defaults and keeps
   your own values. The `--set` lines move every protocol even if the
   chart's default for one is still off.

4. Watch the service-setup Job and find its summary line:

   ```sh
   kubectl -n factory-plus get jobs
   kubectl -n factory-plus logs job/<service-setup job> -c split-drivers -f | grep -i "split\|connection"
   ```

   You should see a line per connection moved, then
   `Split drivers: <n> connections moved, 0 repaired, 0 already right, ...`,
   where `<n>` is the number of rig connections plus any others on the
   cluster.

5. Watch the Edge Agents restart with their sidecars:

   ```sh
   kubectl get pods -n $EDGE_NS -l factory-plus.app=edge-agent -w
   ```

   Each rig Edge Agent restarts once or twice. Afterwards each has one
   container per connection more than before
   (`2/2`, `3/3` and so on). List them:

   ```sh
   kubectl get pods -n $EDGE_NS -l factory-plus.app=edge-agent -o jsonpath='{range .items[*]}{.metadata.labels.factory-plus\.name}{": "}{range .status.containerStatuses[*]}{.name}={.ready} {end}{"\n"}{end}'
   ```

   Every `driver-<id>` container should be `true`.

6. If step 1.1 showed different hashes, merge `acs` into `main` of the
   chart repository now, as the split drivers page says.

#### The ACS-35 change

The busiest production Edge Agent (one MQTT connection, 7 devices,
2,721 metrics) runs a hand-built image pinned in its Deployment, and
must move to the standard image before version 7 (ACS-35). Its devices
read two kinds of topic: some publish one JSON object per message,
and others publish a JSON array of `{value, timestamp}` items. The
hand-built image handles both under `JSON`. The standard image needs
`JSON (Batched)` for the arrays, and from version 7 (ACS-13) it also
reads a single object under `JSON (Batched)`. So the change is the
payload format and the pin together, and the image pin also has to go
before the version 7 upgrade, because a split driver sidecar takes its
image tag from the same setting and no driver image exists at the old
tag.

The rig's copy of that connection publishes arrays on its `$.value`
topics and objects on the rest, and its Edge Agent pins the image tag
the cluster runs. The dev cluster can't run the hand-built image, so
before the change the rig's copy runs the standard image under
`JSON`, which reads the objects and drops the arrays.

What to look for, in the upgrade recording and in the comparison of
step 8:

- **Between the change and the upgrade**, on the version 6 image: the
  array metrics start getting values, and the object metrics stop.
  Every version 6 release rejects a payload that isn't an array under
  `JSON (Batched)` ("payload must be an array" in the Edge Agent log).
  On the rig this lasts until the upgrade. On production it would
  last until production is upgraded, so the change must not be made
  on production while it runs version 6. Two orders avoid that: upgrade
  production to version 7 with `serviceSetup.config.splitDrivers.MQTT`
  set to `hold`, so its MQTT connections stay built in and the pinned
  agent keeps its image, then make the change, then upgrade again with
  `MQTT: true`; or release the version 7 reading of single objects as a
  version 6 patch first.
- **After the upgrade**, on the standard version 7 image and moved to
  the MQTT split driver: every object metric has values again, and the
  array metrics keep theirs. In step 8 the comparison with
  `before.json` lists the array metrics as getting values only after
  (a warning) and nothing as stopped. That is the proof that the
  change gives the same data as before, plus the array data the
  hand-built image gave and the standard image under `JSON` didn't.
- No `ImagePullBackOff` on its `driver-` container, because the pin is
  gone.

**If it fails.** `ImagePullBackOff` on a `driver-` container means the
edge cluster has the old charts (step 1.1) or the image is missing
from the test build (step 6). Merge the charts or publish the image:
there is no move back, so the connection's data returns when its
sidecar starts. A `failed` count above 0 in
the summary line names the connection on the line above it.

### 8. Record the after state and compare

1. Record for 15 minutes once every pod is ready:

   ```sh
   rig check record --rig /rig/rig.json --seconds 900 --label after --rebirth --out /rig/after.json
   ```

2. Compare:

   ```sh
   rig check compare /rig/before.json /rig/after.json
   ```

   It prints a table with each device's DDATA per second and metrics
   per DDATA before and after, its longest gap after, and its result:
   `ok`, `EXPECTED`, `WARN` or `FAIL`. Then it lists the failures, the
   warnings and the expected differences, one line each. It exits
   non-zero only if something failed.

   It fails a device when:

   - a metric it was born with before is missing after, or a new one
     appears, or a type changed;
   - a read metric that got values before gets none after;
   - its DDATA rate rose above 3 times or fell below half (a split
     driver must not multiply the broker's load, ACS-45).

   These are the differences the move is meant to make, and it reports
   them as `EXPECTED`, not as failures:

   - a device the built-in connection starved now publishing. On a
     multi-device OPC UA connection the built-in connection gave values
     only to the last device;
   - DateTime metrics getting values, where the built-in sent none;
   - the UDP device publishing, because before the upgrade nothing
     outside the cluster could reach the built-in UDP connection;
   - ISA-95 hierarchy metrics added to a device that had none. The
     upgrade places such a device at the organisation.

   It warns when the DDATA rate rose above 1.5 times (or above 3 times
   while metrics are newly getting values, which add messages of their
   own), when no birth was seen, when other metrics get values only
   after, and when there are more DDEATHs after.

   Metrics are compared by name. A recording that starts while the
   agents are running gets DDATA, which names metrics only by alias,
   before the rebirth's DBIRTH. The recorder names those from the
   device's first DBIRTH in the same recording. Any it can't name are
   left out and counted in a warning, so record with `--rebirth`.
   Summaries recorded before this change still hold `(alias N)`
   metrics, and the comparison skips and counts those too.

   What the local runs showed, so you know what to expect: REST, MQTT
   and UDP devices matched exactly, with the same metrics and the same
   DDATA rates. OPC UA devices send the same values in more DDATA
   messages after the move: from 1.2 to 2.4 times as many with ACS-45's
   grouping in, which ACS-45 expects and reports as a warning. On a
   multi-device OPC UA connection the devices the built-in connection
   starved get values after the move, which shows as expected.

3. Read the upgrade recording's gaps:

   ```sh
   rig check compare /rig/before.json /rig/upgrade.json
   ```

   The `longest gap` column is each device's longest time without data
   across the upgrade. It should be no longer than the Edge Agent's
   restarts, a few minutes at most. Ignore the rate column here,
   because the recording includes the outage.

4. Resources after:

   ```sh
   kubectl top pods -n $EDGE_NS --containers | tee "$RIG/top-after.txt"
   ```

   Compare each rig Edge Agent's `edge-agent` container with
   `top-before.txt`, and note each `driver-` container's CPU and
   memory. Record the figures on the card.

### 9. The specific checks

**Dotted names.** The rig has REST connections with dots and spaces in
their names. In the service-setup log each has a driver id such as
`rig-api-example-org-1a2b3c4d`, its sidecar is running, and its device
passes the comparison.

**UDP from outside the cluster.** With the sender from step 4.5
running:

1. The UDP Edge Agent's Deployment has a host port:

   ```sh
   kubectl get deploy -n $EDGE_NS -l factory-plus.name=<UDP rig agent> -o jsonpath='{.items[0].spec.template.spec.containers[*].ports}'
   ```

   You should see `hostPort` with the connection's port and `UDP`.
2. On the node, the portmap rule exists:

   ```sh
   ssh <user>@<node> sudo iptables -t nat -S | grep <port>
   ```
3. The UDP device now publishes: its line in the after recording has
   values and a DDATA rate close to the sender's (one datagram a
   second for the example). The sender's own count is on its control
   port: `curl -s localhost:9004/status` from inside the sender's
   container, or read its log.
4. Restart the Edge Agent pod mid-stream and check data resumes within
   a minute (stale UDP connection tracking would stop it):

   ```sh
   kubectl delete pod -n $EDGE_NS -l factory-plus.name=<UDP rig agent>
   ```

**OPC UA writes.** Pick an OPC UA device and one of its metrics with an
address from `coverage.md` or `rig.json`, then:

```sh
rig write --rig /rig/rig.json --connection <opcua id> --device <device id> --metric <metric name> --value <value>
curl -s localhost:9001/status | jq '.[] | select(.id=="<opcua id>") | .writes'
```

The mock lists the write with the node id and value. The device's next
DDATA has the written value until the mock's data replaces it. The
writer sends the metric's Sparkplug type (a config type such as
`FloatLE` is sent as `Float`). No source connection marks a metric as
writable, so this only shows the path works.

**Offline and back.** Stop one mock of each protocol, wait, start it:

```sh
curl -s -X POST localhost:9001/mocks/<opcua id>/stop
sleep 120
curl -s -X POST localhost:9001/mocks/<opcua id>/start
```

Run a short recording around it
(`rig check record ... --seconds 300 --label outage --out /rig/outage.json`).
Each device on the stopped connection should get a DDEATH within about
a minute and a DBIRTH after the mock starts again. For REST the split
driver marks devices offline only when every endpoint has failed for a
whole poll round, so wait at least that long. Do it for one MQTT
(`localhost:9002`) and one REST (`localhost:9003`) mock too.

The built-in MQTT connection sends no DDEATH when its broker stops: its
devices just go quiet and are born again when the broker returns. The
split MQTT driver sends a DDEATH and a DBIRTH. So run this check after
the upgrade, and expect the before state to differ.

**A value that changes while the connection is down.** This is the
check for the OPC UA driver's reconnect fix: after a short network drop
in which the server stays up, the driver must report a value that
changed during the drop, even though it does not change again. A server
restart doesn't test this, because the driver then makes a new session
and subscription and reads every value afresh. Run it after the
upgrade on one OPC UA connection, then on one MQTT and one REST
connection if you want the same for those drivers.

The mocks' control API holds values still and cuts connections with
the server left running:

| Request | What it does |
|---|---|
| `POST /mocks/<id>/freeze` | Hold every value where it is. The replay carries on underneath, but nothing is applied. |
| `POST /mocks/<id>/set` with `{"address": ..., "value": ...}` | Change one address once: an OPC UA node id (the value as the node's type), an MQTT topic (the payload, or a bare value on an array topic) or a REST path (the body, held until `thaw`). |
| `POST /mocks/<id>/drop?seconds=<n>` | Cut every client's connection and reset any new one for `n` seconds (default 30). The server stays up, so the client sees a network drop, not a restart. |
| `POST /mocks/<id>/thaw` | Go back to the replay. |

Pick an OPC UA connection, one of its devices and one numeric metric,
with its node id, from `rig.json`. Then, in two terminals:

1. Start a recording that watches the metric, from the checker's shell:

   ```sh
   rig check record --rig /rig/rig.json --seconds 240 --label reconnect --out /rig/reconnect.json --watch <rig node>/<device id>/<metric name>
   ```

2. In the other terminal, freeze the mock, wait for the metric to
   settle, drop the clients for 60 seconds, change the value 10
   seconds into the drop, and leave it still:

   ```sh
   M=localhost:9001/mocks/<opcua id>
   curl -s -X POST $M/freeze; sleep 30
   curl -s -X POST "$M/drop?seconds=60"; sleep 10
   curl -s -X POST $M/set -d '{"address": "<node id>", "value": 4321}'
   ```

3. When the recording ends, thaw the mock:

   ```sh
   curl -s -X POST $M/thaw
   ```

The `--watch` lines list every value the metric was published with,
with the seconds since the recording started. **Pass:** after the drop
ends (about 40 s plus the driver's reconnect time), a DDATA or DBIRTH
has `4321`. **Fail:** the metric stays at the frozen value to the end
of the recording. A DDEATH during the drop, then a DBIRTH, is expected.

`curl -s localhost:9001/status` shows `frozen` and, during a drop,
`dropped_until`. The same requests work on MQTT (`localhost:9002`) and
REST (`localhost:9003`) mocks. UDP mocks have no clients to drop.

### Protocol checks

These are the checks each protocol's PR or card asks for at the cluster
test, collected on 2026-11-17.

**REST (ACS-23, PR 903 merged):**

- every REST connection's data continues with no gap longer than one
  restart (steps 7 and 8);
- the new `WARNING: branch main of shared/helm has commits of its own`
  line, if the chart repository has its own commits;
- whether any Deployment pins its own image tag (step 1.2);
- the sidecars' CPU and memory (step 8.4);
- the Manager offers one REST driver, called "REST", for new
  connections, and shows moved connections with it.

**MQTT (ACS-25, PR 909 open):**

- the upgrade itself, data continuity, and `kubectl top` of a moved
  agent (steps 7 and 8);
- a connection with wildcard topics and TLS, and `ws` or `wss`
  brokers. The rig has no TLS or WebSockets (see above), so those need
  a real broker;
- the Manager offers one MQTT driver for new connections;
- the heaviest MQTT connection: compare the Edge Agent's and sidecar's
  CPU before and after (step 8.4), and check no messages are lost at
  its peak rate (its DDATA rate in step 8.2);
- an Edge Agent whose Deployment sets `values.image.default` must
  have that removed before the upgrade, or its sidecar can't pull.

**OPC UA (ACS-26 PR 905 merged, ACS-27 PR 911):**

- each security policy: the rig has None, Basic256, Basic256Sha256 and
  Aes128_Sha256, with and without a login;
- metric paths cleared and payload formats rewritten from "Defined by
  Protocol" when the connection moves: check values and timestamps
  after the move (step 8);
- multi-device connections: after the move every device gets values,
  where the built-in connection gave them only to the last device;
- paths stay gone after the Manager saves a moved device (its
  DriverDef has `metricPaths: false`), and are gone from DBIRTH;
- a DateTime metric shows a date, where the built-in published 0;
- an OPC UA mock stopped mid-run marks its devices offline, and they
  rebirth when it starts again;
- a value changed during a short network drop, and still after it, is
  reported after the driver reconnects (step 9, "A value that changes
  while the connection is down");
- DDATA rate after the move (ACS-45): the comparison warns above 1.5
  times the built-in rate and fails above 3 times or below half. The
  golden harness measured about 2 times (2.1 DDATA/s against 1.0 for
  113 metrics at 1 s), so expect the warning, not a failure;
- `OPCUA: false` is refused (step 10) and data carries on;
- whether each real server trusts the driver's certificate. The mocks
  can't show this. The built-in connection already presented a new
  self-signed certificate from every new pod (it is kept in an
  `emptyDir`), so a server that kept working across Edge Agent
  restarts should accept the driver's.

**UDP (ACS-38 PR 907 and ACS-43 PR 904, both merged):**

1. The `split-drivers` summary line counts the UDP connection as moved,
   the Manager shows its driver as "UDP", and the Edge Agent pod has a
   running `driver-<id>` container.
2. The Deployment's values have `hostPorts` for the connection's port
   and the node has the portmap rule for it. Datagrams from outside the
   cluster reach the driver (step 9).
3. Data continues at the device's rate after a restart, and the driver
   logs no drops at that rate. Restart the agent pod mid-stream and
   check data resumes.
4. With two Edge Agents pinned to one host, each with a built-in UDP
   connection on the same port, both move: the first keeps the port and
   its data, the second has no `driver-` container and an `ERROR` line
   naming both connections and the port, and both Edge Agent pods start
   with their other connections working. Change the second's port in
   the Manager and save it: its sidecar starts and it gets data. The rig
   has one UDP connection, so this needs a second one made by hand.
5. `UDP: false` is refused (step 10) and data carries on.
6. The sidecar's CPU and memory at the device's rate.
7. Change the port and check it moves, and check any firewall or
   NetworkPolicy, and the receive buffer after raising
   `net.core.rmem_max` on the node.

**Grouped DDATA (ACS-45, PR 908 merged):** the DDATA rate check in
step 8. PR 908 lists no cluster checks of its own. Its
`DRIVER_DATA_WAIT_MS` setting is off by default, and the remaining
OPC UA gap needs a driver fix (no `TCP_NODELAY` in the Rust drivers'
MQTT client), so expect OPC UA warnings, not failures.

### 10. Check a version 6 `false` is refused

Version 7 has no built-in connections, so there is nothing to move
back to.

1. Record a baseline with everything moved:
   `rig check record --rig /rig/rig.json --seconds 600 --label moved --rebirth --out /rig/moved.json`.
2. Upgrade with a version 6 setting that asked for a move back:

   ```sh
   helm upgrade acs amrc-connectivity-stack/amrc-connectivity-stack -n factory-plus --version 7.0.0-dev.N --reuse-values --set serviceSetup.config.splitDrivers.OPCUA=false
   ```

3. The service-setup log has `ERROR: serviceSetup.config.splitDrivers.OPCUA is false`,
   and the summary line counts every connection as already right. No
   `driver-` container goes.
4. Record (`--label refused`) and compare with `moved.json`: they should
   match.
5. Upgrade again with `--set serviceSetup.config.splitDrivers.OPCUA=hold`.
   The log has `ERROR: serviceSetup.config.splitDrivers.OPCUA is 'hold',
   so 0 OPCUA connection(s) stay on the built-in`: every one has
   already moved, and `hold` moves none back. The comparison with
   `moved.json` matches. Upgrade once more without it.

### 11. Clean up

1. See what the remover would delete:

   ```sh
   rig remove --rig /rig/rig.json
   ```

   It lists the rig's Edge Agents (by UUID and by any Edge Agent named
   `Rig_...`), their connections and devices.
2. Delete them:

   ```sh
   rig remove --rig /rig/rig.json --yes
   ```

   The edge cluster removes the Edge Agents' pods within a few
   minutes.
3. Stop the UDP sender and remove the mocks:

   ```sh
   docker stop rig-udp
   kubectl delete namespace acs-rig
   ```

4. Check what was there before is still there, as in step 1.3, and
   remove the image from the node if you want the space back:

   ```sh
   ssh <user>@<node> sudo k3s ctr images rm docker.io/library/acs-rig-mocks:amd64
   ```

## Trying the rig on one machine

`rig local` runs a few rig connections, real Edge Agents and the split
drivers, all in one process with a local MQTT broker, and records the
output as `rig check record` would. Every chosen connection needs its
driver in `--split`, because the Edge Agent has no built-in connections
since version 7. For a built-in run to compare with, build the rig
image from a tree that still has them (the commit before ACS-30, or a
version 6 tag) under another name, say `acs-rig-mocks:v6`. Build the
drivers as the golden harness README describes, then:

```sh
docker run --rm -v <private folder>:/p acs-rig-mocks:v6 local --rig /p/rig/full/rig.json --only <id,...> --seconds 120 --label built-in --out /p/rig/local/before.json
docker run --rm -v <private folder>:/p -v "$PWD/edge-rest/target/release/driver:/drv/rest:ro" acs-rig-mocks:dev local --rig /p/rig/full/rig.json --only <id,...> --seconds 120 --label split --split REST=/drv/rest --out /p/rig/local/after.json
docker run --rm -v <private folder>:/p acs-rig-mocks:dev check compare /p/rig/local/before.json /p/rig/local/after.json
```

`--outage <id>:<from s>:<length s>` stops a mock during the run, and
`--write <id>:<device>:<metric>:<value>:<at s>` sends one write. The
image is Debian-based so drivers built in `rust:1.99` run in it.
