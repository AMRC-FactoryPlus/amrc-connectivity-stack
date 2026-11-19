# Gateway Depot

The Gateway Depot turns a blank PC into a Factory+ cell gateway without
anyone typing on the gateway. It covers the steps the [edge bootstrap
process](../architecture/edge-management/edge-bootstrap.md) leaves to the
site: installing an operating system, setting up the network and
firewall, installing Kubernetes, and running the bootstrap.

## Objectives

* A person with a browser and the right permission can provision a
  gateway. They do not need a terminal on the gateway, a Kerberos
  administrator's password, or knowledge of Kubernetes.
* Nothing is written to a machine until someone has approved it.
* The install media carries no settings and no secrets, so one USB stick
  serves every gateway.
* Every gateway is on record in the ConfigDB.

## How it works

A cell gateway is a small PC with two wired network ports. The
*northbound* port connects to the site network. The *southbound* port
connects to the machine's own network. The gateway never routes between
them.

1. Boot the blank PC from the depot stick with a network cable in. The
   stick is a stock Ubuntu Server installer with one addition: before the
   installer does anything, a *scout* reports the machine's serial number,
   network ports and disks to the Gateway Depot service, and waits.
2. The gateway appears in the Admin UI under Gateway Depot. Someone
   checks the serial number against the label, chooses the northbound and
   southbound ports, the southbound address and the disk, and approves it.
3. The scout collects the installer settings and the install runs
   unattended. The gateway downloads the setup scripts and K3s from the
   service, so the stick does not go out of date. It then powers off.
4. Install the gateway at the edge and power it on. On first boot it sets
   its hostname, network and firewall, and an *agent* starts calling the
   service. K3s is not set up yet, because a cluster records the address
   it was created on.
5. Onboard the gateway from the Admin UI. The service creates an edge
   cluster, asks the Cluster Manager for an [enrolment
   token](../architecture/edge-management/edge-bootstrap.md#enrolment-tokens),
   and hands the gateway a job. The gateway installs K3s and runs the
   bootstrap script with the token.

A further gateway can *join* the cluster of one that is already
onboarded. The first gateway makes a short-lived K3s join token when the
service asks for one.

A new gateway can *replace* one whose hardware has died. It takes over
the old gateway's edge cluster, and by default its hostname, so the
deployments pinned to that hostname start on the new machine.

## Architecture

The service is a normal central ACS service. It authenticates callers
with the shared HTTP authentication, keeps its records in the ConfigDB,
and checks permissions with the Auth service.

The gateway side is a set of shell scripts and one Python script. They
live in `acs-gateway-depot/gateway` and are built into the service's
image, which serves them to a gateway while it installs.

| Part | Runs | Does |
| --- | --- | --- |
| Scout (`agent.py scout`) | In the Ubuntu installer, before the install | Reports hardware, waits for approval, writes the installer settings |
| Setup scripts (`sh/`) | On first boot, and again at onboarding | Hostname, network, firewall, K3s |
| Agent (`agent.py agent`) | On the installed gateway | Calls the service, runs the jobs it is given |

The agent only ever calls out. Nothing connects in to the gateway.

### Trust

A gateway proves who it is with a secret it makes up when its scout
first calls. The service keeps a hash of the secret. Until a person
approves the gateway, the service holds it in memory only: an unknown
machine on the network cannot create ConfigDB objects by calling in.

The installer settings contain the hash of the gateway's admin password,
and the service only gives them to the gateway that was approved. The
password itself is shown once, to the person who approved the gateway,
and is not stored.

An onboarding job carries an enrolment token. The service holds jobs in
memory and hands each one over once.

## HTTP API

The service's URL is found through the Directory. All paths below are
under `/v1`. Errors have a JSON body `{ "error": "..." }` with a message
written for the person using the Admin UI.

### For people

These need the **Provision gateways** permission with a wildcard target.

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `gateway` | Lists the gateways, newest first |
| `GET` | `settings` | Returns `{ defaults: { admin_user }, k3s_version }` |
| `GET` | `stick` | Says whether the depot stick is built: `{ state }`, where `state` is `ready`, `building` or `none`. A ready stick also has `{ url, size, ubuntu, built_at, current }`. `current` is false when the stick was built for an older release |
| `GET` | `cluster` | Lists edge clusters: `{ uuid, name, reported, hosts, gateway }`, where `gateway` is the id of the cluster's first gateway if the depot built it |
| `POST` | `gateway/:id/approve` | Approves a gateway that is waiting. Returns `{ gateway, admin_user, password }`. This is the only time the password is available |
| `POST` | `gateway/:id/onboard` | Starts onboarding. Returns `{ gateway }` at once; progress follows in the gateway's state |
| `DELETE` | `gateway/:id` | Removes the record. Does not change the gateway |

`approve` takes:

```json
{
  "north_mac": "00:e0:4c:68:01:a1",
  "south_mac": "00:e0:4c:68:01:a2",
  "south_addr": "192.168.1.200/24",
  "disk": "/dev/nvme0n1",
  "admin_user": "fplus",
  "label": "tapeline",
  "ssh_keys": "ssh-ed25519 AAAA... one per line",
  "replaces": "id of the gateway this one replaces",
  "keep_hostname": true
}
```

`south_mac` may be empty for a gateway with one network. `south_addr` is
an address with a prefix length, or `dhcp`. `replaces` and
`keep_hostname` are optional.

`onboard` takes one of:

```json
{ "mode": "create", "cluster_name": "Tapeline" }
{ "mode": "join", "server": "id of the first gateway of the cluster" }
{ "mode": "join", "k3s_url": "https://host:6443", "k3s_token": "..." }
```

A replacement gateway takes `{ "mode": "create" }` with no cluster name,
because it takes over the cluster of the gateway it replaces.

A gateway looks like this. Fields appear as it progresses.

```json
{
  "id": "5b13e886-8fe5-49e5-b12f-0468cb642e46",
  "uuid": "36a4fe61-2ebb-4c76-86c0-edb04b1b9703",
  "state": "pending",
  "online": true,
  "first_seen": 1795082353418,
  "last_seen": 1795082356436,
  "remote_ip": "10.31.4.57",
  "approved_by": "alice@REALM",
  "approved_at": 1795082400000,
  "installed_at": 1795083300000,
  "ready_at": 1795086000000,
  "onboarded_at": 1795086400000,
  "install_failed": false,
  "replaces": "id",
  "replaced_by": "id",
  "inventory": {
    "serial": "PF550F40", "vendor": "LENOVO", "model": "ThinkEdge SE30",
    "arch": "amd64", "memory": 8589934592, "cpus": 4,
    "nics": [ { "name": "enp1s0", "mac": "00:e0:4c:68:01:a1", "link": true, "speed": "1000", "driver": "igc", "ipv4": "10.31.4.57/24" } ],
    "disks": [ { "path": "/dev/nvme0n1", "size": 256060514304, "model": "SAMSUNG MZVLB256", "serial": "S4X", "transport": "nvme" } ]
  },
  "settings": { "north_mac": "...", "south_mac": "...", "south_addr": "...", "disk": "...", "admin_user": "fplus", "label": "tapeline", "hostname": "only for a replacement that keeps a hostname" },
  "report": { "hostname": "fpcgw-pf550f40", "north": "enp1s0", "south": "enp2s0", "k3s": "v1.34.13+k3s1", "nics": [] },
  "onboard": {
    "mode": "create", "by": "alice@REALM", "started": 1795084865618,
    "step": "The gateway is creating its cluster and joining Factory+",
    "error": "only when state is failed",
    "server": "id, when it joined another gateway's cluster",
    "cluster": { "uuid": "...", "name": "Tapeline", "name_given": "Tapeline" },
    "reported": true
  },
  "log": "the last 16000 characters of the gateway's setup log"
}
```

`id` is the gateway's own identifier and is what the API paths use.
`uuid` is its ConfigDB object and is absent until the gateway is
approved. `online` means the gateway called in within the last 90
seconds.

| State | Meaning |
| --- | --- |
| `pending` | The scout is running and waiting for approval |
| `approved` | Approved; the scout has not collected its settings yet |
| `installing` | Ubuntu is installing. The gateway is not in contact |
| `installed` | Installed and powered off |
| `ready` | Booted at the edge and configured, with no cluster yet |
| `onboarding` | Creating or joining a cluster |
| `onboarded` | In service |
| `failed` | The install or the onboarding failed. `install_failed` says which |
| `replaced` | Another gateway has taken its place |

### For gateways

These need no Factory+ credentials. The scout and the agent send the
gateway's secret in the request body.

| Method | Path | Does |
| --- | --- | --- |
| `POST` | `box/scout` | Registers a waiting machine, or collects its installer settings once it is approved |
| `POST` | `box/:id/checkin` | Reports what an installed gateway is doing, and collects a job |
| `GET` | `payload/gateway-:sha.tar.gz` | The setup scripts |
| `GET` | `payload/k3s-:arch` | The K3s binary |
| `GET` | `payload/depot-stick-amd64.iso` | The depot stick, for a browser to download. It holds no settings and no secrets |

## ConfigDB

Each approved gateway is an object of class *Cell gateway*
(`e763cbcd-157c-40d5-8e54-87c0647d9e07`).

| Application | UUID | Holds |
| --- | --- | --- |
| Cell gateway provisioning | `a67ed556-80e0-43d2-bd6e-3d25122b9a80` | The gateway's record: hardware, settings, state and history |
| Cell gateway provisioning private state | `90b6d8ce-d5e3-4c9e-afde-624f93d893b4` | Hashes of the gateway's secret and of its admin password |

What changes every few seconds is not written to the ConfigDB: when the
gateway last called, whether a cable is in, and its log.

## Auth

| Permission | UUID | Allows |
| --- | --- | --- |
| Provision gateways | `f8a2ad0a-6a2f-4b1a-b8fe-958e7b01fd94` | Using the Gateway Depot. Grant it with a wildcard target |

Administrators hold it by default. The service's own account,
`sv1gatewaydepot`, may keep its records, create and name edge clusters,
ask the Cluster Manager for enrolment tokens, and read who holds
Provision gateways.

## Settings

Set these under `gatewayDepot` in the ACS Helm values.

| Value | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Deploy the service. It adds the host `gateway-depot.<acs.baseUrl>`, which must resolve |
| `gateway.registryMirror` | empty | A container mirror for K3s on the gateways. Empty means none |
| `gateway.aptMirror` | empty | An apt mirror for the gateways. Empty means the Ubuntu archive |
| `gateway.aptMirrorKeySha256` | empty | The SHA-256 of `<aptMirror>/keyring.gpg` |
| `gateway.aptMirrorOrigin` | empty | The origin the mirror publishes with, for automatic updates |
| `gateway.adminUser` | `fplus` | The default name of the admin user on a gateway |
| `gateway.locale` | `en_GB.UTF-8` | The gateway's locale |
| `gateway.keyboard` | `gb` | The gateway's keyboard layout |
| `gateway.timezone` | `Europe/London` | The gateway's timezone |
| `gateway.privateCASecret` | empty | A Secret whose `ca.crt` is the CA certificate, if ACS uses a private CA. The depot stick then carries it |
| `stick.enabled` | `true` | Build the depot stick in the cluster, for download from the Admin UI |
| `stick.storage` | `10Gi` | Space for the Ubuntu image and the stick |
| `stick.storageClass` | empty | The storage class for that volume. Empty means the default |
| `stick.ubuntuIsoUrl` | empty | Where to download the Ubuntu Server image from, if not `releases.ubuntu.com` |

## The depot stick

Download the depot stick from the Gateway Depot page of the Admin UI and
write it to a USB stick. A machine booted from it does not touch its
disk until someone approves it.

The chart builds the stick. A Job runs `stick/bake.sh` on every install
and upgrade. It downloads the Ubuntu Server image, checks it against a
pinned checksum, adds the scout and the service's address, and writes
the result to a volume the service serves it from. The Job does nothing
when the stick on the volume was already built from the same address,
scout and Ubuntu version, so most upgrades leave it alone.

The Job needs to reach `releases.ubuntu.com`, or the address in
`stick.ubuntuIsoUrl`. The volume attaches to one node, so the Job runs
on the node the service runs on.

To build a stick by hand, for example with `stick.enabled` off:

```sh
cd acs-gateway-depot
stick/fetch.sh
stick/build-stick.sh -u https://gateway-depot.<acs.baseUrl>
```

Add `-C ca.pem` if the service's certificate comes from a private CA.

## Testing

`acs-gateway-depot/test/vm.sh` runs a depot stick in a QEMU virtual
machine with a northbound and a southbound port. See the comment at the
top of the script.
