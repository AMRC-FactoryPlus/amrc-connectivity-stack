# Edge Clusters: Overall Architecture

As of ACS version 3 we require the machines running Edge Agents and
actually collecting data (the edge) to be part of one or more Kubernetes
clusters separate from the cluster running the central services. This is
partly to make the architecture more flexible, allowing for example a
central cluster which is cloud hosted or hosted on a managed Kubernetes
cluster and the edge to use `k3s` or `microk8s` or some other Kubernetes
distribution tailored to edge devices. It is also, we believe, the
correct thing to do from a security perspective: physical compromise of
a machine joined to a Kubernetes cluster compromises the entire cluster,
and keeping edge devices to their own cluster limits the possible
damage.

## Central Cluster

The central Kubernetes cluster runs a number of essential services:

* The MQTT broker all the MQTT traffic passes through.
* The ConfigDB which stores configuration for the ACS components.
* The KDC which provides authentication services.
* The ACS Manager which provides a user interface.

There are also others, such as the Directory for locating devices and
services and the Historian for recording data, but these are not
relevant here. Additionally, to support edge clusters, the central
cluster also provides:

* A Git server providing Git repositories integrated with the ACS Auth
  system.
* The Cluster Manager service, which is responsible for setting up edge
  clusters in the central services.

## Edge Clusters

Edge devices on the shop floor must then be joined into a number of edge
clusters. Choosing how to assign edge devices to clusters is a local
administration decision; having a single edge cluster is a reasonable
choice. For example, at the AMRC we have decided to separate our edge
clusters by building.

Each edge cluster runs the following services to allow control from the central cluster:

* [Flux](https://fluxcd.io), an industry-standard tool for maintaining the state of
* a Kubernetes cluster based on a Git repository.
* The Kerberos Keys Operator, which is an ACS component allowing
  accounts for edge devices to be securely created in the central KDC.
* The Edge Sync Operator, which reports to the centre on the current
  state of the cluster and acts on instructions from the centre to
  deploy Edge Agents.
* The Edge Monitor, which ensures that deployed Edge Agents are running
  correctly and using their latest configuration.

When an edge cluster is created in the central Manager, the Cluster
Manager creates a new Git repository for the new cluster and populates
it with Kubernetes manifests to deploy these pieces. Then a bootstrap
script (provided by the Cluster Manager) is run against the edge
cluster, which requests an administrator's credentials and uses them to
create credentials for the Kerberos Keys Operator. After that the edge
cluster is (supposed to be) self-maintaining, with everything that
happens on the edge driven by configuration from the central cluster.

## Sparkplug Groups

Sparkplug addresses have a fairly limited structure: there are three
levels, Group, Node and Device, and an Edge Agent publishing metrics is
required by protocol to sit at the Node level. This leaves Group as a
single-level classification of Nodes.

As a result of this, we have found it useful at the AMRC to institute a
convention for Group names that they should consist of hierarchical
parts separated by hyphens. So, for example, those Nodes in our MKI
building at Factory 2050 might be in the Group `AMRC-F2050-MK1`. The
Visualiser component released as part of ACS version 3 assumes such a
naming convention for Groups.

The edge cluster support in version 3 formalises this convention in the
following respects:

* Each edge cluster has an associated Sparkplug Group.
* All Edge Nodes deployed to a particular cluster have Sparkplug
  addresses under that group.
* The group name the form `ORG-Cluster-Name`, where `ORG` is the value of
  `acs.organisation` supplied in the ACS `values.yaml` and
  `Cluster-Name` is the name assigned to the cluster.

## Soft Gateways

Since the beginning of the Factory+ project we have found it necessary
to have a number of Edge Agents running not on physical machines on the
shop floor but on VMs provided by our IT team. These are needed when we
are not interfacing directly with the device producing the data but with
some other existing system, including situations where we are pulling
data from entirely outside our organisation into Factory+. While this is
not ideal from the point of view of the Factory+ principle of pushing
data collection to the edge, sometimes pragmatism needs to win out over
principle.

These Edge Agents are referred to as 'soft gateways', for historical
reasons. Under the previous version of ACS, where all machines were part
of a single cluster, the Soft Gateways ran directly on the central
cluster as Kubernetes Deployments. As of version 3 this is no longer
possible, and no Edge Agents can run on the central cluster. There are
instead two possibilities:

* For situations where having the Edge Agent present in a particular
  geographical location is desirable, perhaps because it is known that
  the other system it is communicating with is also in that location, an
  Edge Agent can be deployed 'floating' to an ordinary edge cluster on
  the shop floor. This will result in the Edge Agent being run on one of
  the machines that form that cluster, chosen by the Kubernetes control
  plane. If a machine goes offline the floating Edge Agents that were
  running on it will be restarted on a different machine.

* For situations where it is desirable to run the Edge Agent on central
  infrastructure, perhaps because it is reading data from outside the
  organisation, a dedicated 'soft gateways' cluster will need to be
  created alongside the central cluster. Edge Agents can then be
  deployed (almost certainly 'floating') to this cluster.

## Specialised Hosts

Some machines on the shop floor will not be suitable for running
general-purpose workloads such as the cluster operators and floating
Edge Agents. This may be because of their hardware (for example,
Raspberry Pis which have limited CPU and memory) or because of their
operational situation (for example, because they are frequently switched
off without warning).

Kubernetes can be instructed not to deploy workloads to particular nodes
using
[taints](https://kubernetes.io/docs/concepts/scheduling-eviction/taint-and-toleration/).
Hosts in an ACS edge cluster which should not accept general-purpose
workloads should be tainted using the key
`factoryplus.app.amrc.co.uk/specialised` and (usually) the effect
`NoExecute`. Edge deployments which are targeted to a specific hostname
will tolerate this taint, but floating deployments and cluster operators
will not. Taints with a different key should be used for other purposes,
e.g. because a host has been temporarily taken out of service.

The value of the `specialised` taint is chosen by the administrator to
indicate why the taint was applied. The value is ignored by the Helm
charts. When deploying a new Edge Agent in the Manager, hosts with this
taint will have the value of the taint displayed after the hostname in
square brackets.

## Network Requirements

All communication between central and edge clusters happens over
Factory+ channels; there is no need for any Kubernetes API access in
either direction. In addition to this, a design requirement was that no
external access to the edge cluster is required at all once the initial
bootstrap has succeeded.

The edge cluster requires access to these services on the central
cluster:

* The MQTT broker, to publish device data and to receive notifications
  from the central services.
* The Factory+ HTTP services, including the Git server.
* The Kerberos interface of the KDC to get authentication tickets.
* The Kerberos Keys Operator on the edge needs access to the admin
  interface of the KDC to create credentials for Edge Agents.

In practice this means ports 8883, 443, 88 and 749 for a 'secure' ACS
installation, and 1883, 80, 88 and 749 for an 'insecure' installation.

While the design of ACS V3 is that edge clusters should be autonomous
and self-maintaining, we cannot at this point recommend isolating a
cluster entirely. In particular, administrator access to the Kubernetes
API on the edge is likely to be useful for management and debugging.

## Communication and Control

Communication and control between the clusters occurs over two channels:
the ACS ConfigDB (Config Store) and the internal Git repositories, both
hosted on the central cluster.

The ACS ConfigDB is a data store that conforms to the Factory+ Config
Store specification. It is designed to associate static, application-specific
configuration with Sparkplug devices, for the sake of data consumers
which need more information about a device than is present in its Sparkplug
output. In ACS, it is used as a general-purpose database with the following
structure:

* An Object in the ConfigDB represents anything that can be identified
  by a UUID.
* Objects are assigned to Classes, largely for historical reasons. New
  Classes should not be created without a good reason; this is not a
  general-purpose classification mechanism.
* One of the classes is Application; an Application represents a
  set of entries in the database made or used for a single purpose.
* The ConfigDB can hold one entry, in JSON form, for each Application,
  for each Object.
* All entries for a given Application should have the same structure,
  which can be described by a JSON Schema associated with the
  Application.
* Each revision of each config entry is given an HTTP ETag in the form
  of a UUID.
* The ConfigDB has an MQTT interface where it publishes information
  about changes to config entries.

A Git repository is created in the internal Git server for each cluster.
This drives the installation of Flux on the edge cluster, which deploys
manifests to the edge to match the current contents of the repo. The
server also provides other repos, most importantly a repo containing
Helm charts which can be deployed to the edge.

The internal Git server has the facility to create an internal repo
which mirrors the contents of an external repo. This is used when the
edge Helm charts are to be pulled from public Github but the edge
clusters do not have access to the Internet.

## Next Steps

- [Edge Deployments](edge-deployments.md) - Learn about deploying to edge clusters
- [Edge Bootstrap](edge-bootstrap.md) - Learn about the bootstrap process for edge clusters
- [Architecture Overview](../overview.md) - Return to the architecture overview
