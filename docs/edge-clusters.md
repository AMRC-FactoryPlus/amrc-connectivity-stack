# ACS Edge Cluster

As of ACS version 3 we require the machines running Edge Agents and
actually collecting data (the edge) to be part of one or more Kubernetes
separate from the cluster running the central services. This is partly
to make the architecture more flexible, allowing for example a central
cluster which is cloud hosted or hosted on a managed Kubernetes cluster
and the edge to use k3s or microk8s or some other Kubernetes
distribution tailored to edge devices. It is also, we believe, the
correct thing to do from a security perspective: physical compromise of
a machine joined to a Kubernetes cluster compromises the entire cluster,
and keeping edge devices to their own cluster limits the possible
damage.

## Architecture

ACS requires a central cluster running the central services and one or
more edge clusters running the Edge Agents.

### Central cluster

The central Kubernetes cluster runs a number of essential services:

* The MQTT broker all the MQTT traffic passes through.
* The ConfigDB which stores configuration for the ACS components.
* The KDC which provides authentication services.
* The ACS Manager which provides a user interface.

There are also others, such as the Directory for locating devices and
services and the Historian for recording data, but these are not
relevant here. Additionally, to support edge clusters, the central
cluster also provides

* A Git server providing Git repositories integrated with the ACS Auth
  system.
* The Cluster Manager service, which is responsible for setting up edge
  clusters in the central services.

### Edge clusters

Edge devices on the shop floor must then be joined into a number of edge
clusters. Choosing how to assign edge devices to clusters is a local
administration decision; having a single edge cluster is a reasonable
choice. For example, at the AMRC we have decided to separate our edge
clusters by building.

Each edge cluster runs these services to allow control from the centre:

* [Flux](https://fluxcd.io), which is an industry-standard tool for
  maintaining the state of a Kubernetes cluster based on a Git
  repository.
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
happens on the edge driven by configuration from the centre.

### Network requirements

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

While the design of ACS version 3 is that edge clusters should be
autonomous and self-maintaining, we cannot at this point recommend
isolating a cluster entirely. In particular, administrator access to the
Kubernetes API on the edge is likely to be useful if things go wrong.

## Deployment process

This description assumes a familiarity with the data structures used by
the Factory+ Config Store (ACS ConfigDB). In brief:

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
* The ConfigDB has an MQTT interface where it publishes information
  about changes to config entries.

### Edge Helm Charts

When an Edge Agent is deployed in the Manager, you need to specify what
you would like to deploy. This will normally be an ACS Edge Agent, but
can also include other services to be deployed to the edge alongside the
Edge Agent. For example, we have developed a simple service which reads
Modbus/TCP and supplies a REST interface the Edge Agent can consume;
this removes the need to keep pushing more drivers into the Edge Agent
codebase itself.

Services that can be deployed to the edge must be packaged in the form
of a Helm chart. These Helm charts live in another Git repo on the
central cluster, from where the Flux installations on the edge clusters
can pull them. A default installation of ACS will pull the on-prem Helm
charts repo from the `edge-helm-charts` repo on the AMRC-FactoryPlus
Github, but this can be changed in the ACS `values.yaml`. Currently all
deployable Helm charts must be present in the `main` branch of the
single Helm charts repo.

In order to allow for deploying the same chart in different
configurations, the ConfigDB contains a set of 'Helm chart template'
entries which are the items which can actually be deployed. These
reference a particular chart in the charts repo and give a template for
the `values.yaml` to use on deployment. This template will be filled in
with a few fixed pieces of information about the deployment such as the
UUID and the hostname of the machine to deploy to.

### Edge deployment

Creating a Deployment in the Manager simply creates an entry in the
ConfigDB detailing what is to be deployed and where. These entries live
under the 'Edge deployment' Application and use the UUID of the Edge
Agent as their Object. The entry specifies the Helm charts to deploy,
the cluster to deploy to, and a name for the deployment; if this is an
Edge Agent then the name will become the Sparkplug Node-ID.

The deployment entry also specifies which host on the cluster to deploy
to, for deployments that target a specific host. It is possible to omit
the hostname by selecting a 'Floating' deployment in the Manager; this
will deploy such that the container might end up running anywhere in the
cluster, subject to 'specialised host' taints applied in Kubernetes.

These deployment entries are picked up by the Edge Sync operator on the
edge cluster. This operator picks out the entries applicable to its own
cluster and uses the 'Helm chart template' entries to construct a set of
Flux HelmRelease Kubernetes objects. 

## Edge Agent configuration

When the Edge Agent configuration is updated in the Manager, this
information also goes into the ConfigDB. The Edge Agent pulls its
configuration from the ConfigDB at startup, and the Edge Monitor tracks
the current state of the ConfigDB and instructs the Edge Agent to reload
its config if it is out of date.
