# Move an edge deployment to another host

## Problem

A cell gateway PC in an edge cluster dies. The site fits a replacement machine,
joins it to the same Kubernetes cluster, and it comes up as a healthy node under
a new hostname (`fpcgw-pf662a11` where the dead one was `fpcgw-pf550f40`).

Everything in ACS is now stuck. The ACS Node was pinned to the dead hostname
when it was first created, and that pin is written into the node's
`Applications/Edge deployment` config. `acs-edge-sync` passes it straight
through to the Helm chart as a `kubernetes.io/hostname` node selector
(`edge-helm-charts/charts/edge-agent/templates/edge-agent.yaml:76`), so the
edge agent pod is unschedulable and stays that way. The Admin UI shows the
host under "Cluster Details" on the node page, as read-only text.

There are two routes out today and both are bad:

1. **Hand-edit raw ConfigDB.** Go to ConfigDB, find `Applications/Edge deployment`,
   find the object by the node's UUID, edit the JSON. An operator will not do
   this, and it silently leaves every connection under that node carrying a
   stale `topology.hostname`, plus `hostPaths` pointing at device nodes
   (`/dev/ttyUSB0`) that may not exist on the replacement machine.
2. **Delete and recreate the node.** This destroys the node UUID, its Sparkplug
   identity, and every device and connection defined under it. Historical data
   is orphaned from the new node.

The machine is replaced. The configuration should follow it. Right now the only
thing standing between the two is one string that the UI refuses to let anyone
change.

## Appetite

10 days.

## Solution

### Elements

**1. The Host detail becomes actionable.**
Node, bridge and generic edge deployment pages all read `deployment.hostname`
from the same app (`App.EdgeAgentDeployment`), so this is one shared component
used in three places. The Host row in Cluster Details gains a `Move…`
affordance.

**2. A stale-host warning.**
Wherever a hostname is shown that is not present in the cluster's
`status.hosts`, flag it. In the replacement story the dead machine has been
removed from the cluster entirely, so this warning is what tells the operator
something is wrong before they go hunting through pod events. Only show it when
the cluster is reporting at least one host, so an edge-sync outage doesn't paint
everything red.

**3. A move dialog** in three steps: choose target, review what comes with it,
apply.

**4. A hostPath list editor**, built as a shared component. Used in the move
flow's review step, and dropped into the connection dialog in the same cycle so
that hostPaths are editable in the ordinary way too, not only while moving. This
is the first time `deployment.hostPaths` has ever been visible in the Admin UI;
today it is written only by the v3 to v4 migration
(`acs-service-setup/lib/manager-devices.js:185`).

**5. One move action** that patches the connections first and the deployment's
own `hostname` last.

### Flow

```
Node page  /  Bridge page  /  Edge deployment
────────────────────────────────────────────
  Cluster Details
    Cluster:  Sheffield Factory 2
    Host:     fpcgw-pf550f40   ⚠ not a host in this cluster   [Move…]
         │
         ▼
Move — 1. Choose target
───────────────────────
  From:  fpcgw-pf550f40   (not currently a host in this cluster)
  To:    ( ) fpcgw-pf662a11    arm64   nothing deployed here
         ( ) fpcgw-pf318c22    amd64   2 deployments
         ( ) Floating          any     run on any host in the cluster
  [Cancel]  [Next]
         │
         ▼
Move — 2. Review what comes with it
───────────────────────────────────
  This deployment
    Cell Gateway            edge agent · Sheffield/Cell_Gateway

  Connections (3)
    Modbus PLC 1            no host paths
    Serial scale            /dev/ttyUSB0  →  [ /dev/ttyUSB0        ]
    Barcode reader          /dev/ttyACM0  →  [ /dev/ttyACM0        ]

    ⚠ Host paths have been carried over unchanged. ACS cannot check
      whether these exist on fpcgw-pf662a11. Confirm them against the
      new machine.

  Devices (7)               unaffected, they follow the node

  [Back]  [Move to fpcgw-pf662a11]
         │
         ▼
Move — 3. Done
──────────────
  Moved to fpcgw-pf662a11.
  The edge agent will go offline and rebirth as it is rescheduled.
  → back to the node page, Host updated, warning gone
```

For a bridge or a generic deployment there are no connections, so step 2
collapses to the deployment itself and a line saying nothing else references
this host. Same dialog, same code path.

## Rabbit holes

**Floating means deleting the key, not writing the string.** The create dialog
already does `delete payload.hostname` when Floating is chosen
(`NewEdgeDeploymentDialog.vue:345`). The move uses a merge patch with
`hostname: null`, which removes it. Do not invent a second convention.

**hostPaths are prefilled, warned about, and never verified.** ACS has no way
to inspect the filesystem of a Kubernetes node, and building one is not in this
appetite. Carry the old paths across as defaults, say plainly that they have not
been checked, let the operator edit them. Do not try to be clever.

**`topology.hostname` on connections is kept in sync, not removed.** Nothing in
this repository reads it. It is written by the connection dialog
(`NewConnectionDialog.vue:588,630`) and by the migration, and the connection
store only binds `topology.cluster`. Removing the duplication is the better
long-term answer, but this cycle keeps it in sync so that nothing outside the
repo breaks. Raise the removal separately once we have confirmed nobody reads it.

**Write order is connections first, deployment last.** There is no transaction
across N+1 ConfigDB patches. Patching the functional field last means a failure
part-way through never leaves a moved deployment with unmoved metadata; it
leaves an unmoved deployment, which is the state the operator already
understands. On failure, name the objects that did not update rather than
showing a generic error.

**A generic deployment's raw `values` blob can override the move.**
`acs-edge-sync/lib/deployments.js:233` merges `spec.values` after the chart's
own values, so a deployment with `hostname` set inside its values will ignore
the new host. Detect that case and warn. Do not rewrite the operator's values
blob for them.

**Permissions are per-object.** A user with write on the node but not on its
connections gets a partial move. Handle it as a named failure list, not a
pre-flight ACL audit.

## No-gos

- **No cluster administration.** The dead machine's Kubernetes node may be
  NotReady and its old pod stuck Terminating. ACS changes desired state; flux
  and Kubernetes deal with the rest. Draining or deleting a dead node stays a
  cluster admin job.
- **No pre-assigning to hosts that have not joined.** The target picker offers
  the hosts the cluster is actually reporting, plus Floating. No free-text
  hostnames.
- **No host-level bulk move.** "Move everything on host A to host B" is a
  different feature. This one moves one deployment at a time.
- **No capacity or scheduling advice.** The picker shows how many deployments
  each host already carries. It does not warn, rank, or refuse.
- **No device changes.** Devices carry no hostname (`deviceInformation.node`
  only) and need no migration. They are shown in the review purely so the
  operator can see they are safe.
- **No verification of device paths on the target machine.**
