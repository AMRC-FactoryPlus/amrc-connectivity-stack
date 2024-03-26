# Edge clusters: Bootstrap process

This document describes the process of setting up a new edge cluster. It
assumes familiarity with [the overall architecture](./edge-clusters.md)
including the data structures used by the ConfigDB. In addition, the
Helm chart templates used are described in full in [the deployment
document](./edge-deployments.md).

![Diagram of edge cluster bootstrap process](assets/edge-clusters/bootstrap.jpeg)

## Scope of ACS bootstrap

The ACS edge cluster bootstrap process starts with a Kubernetes cluster
which is to serve as an edge cluster and makes the required links to the
central cluster to allow for deployment and control. The following steps
are **in scope** for the bootstrap process:

* Creating appropriate entries in the central cluster configuration to
  allow the new edge cluster to function.
* Deploying containers to the edge cluster to allow remote control by
  the central cluster.
* Creating a security association between the edge and central clusters
  so that credentials can be securely created for applications deployed
  to the edge.
* Keeping the central cluster up to date with the current state of the
  edge cluster.

The following steps are **out of scope** and must be performed outside
of the ACS framework:

* Installing appropriate Linux and Kubernetes distributions on the
  machines.
* Configuring network and firewall settings.
* Joining the edge machines into a cluster, and adding and removing
  machines as operational needs change.
* Managing connectivity from the edge cluster machines to the devices
  they are reading data from.

All the edge cluster machines need the following network access:

* Whatever is required to allow the Kubernetes cluster to function.
* Client access to ports 8883, 443, 88 and 749 of the central cluster
  (or 1883, 80, 88 and 749 for an 'insecure' ACS installation).
* The ability to pull the container images required, whether directly
  from the Internet, from a private registry or mirror, or otherwise.
* `kubectl` access to the cluster is required for the initial bootstrap
  step.

## Creating the cluster on the central services

Deploying a new edge cluster starts by using the 'New cluster' interface
in the Manager. This requests a name for the cluster and a Helm chart to
use for the initial cluster setup. This needs to be the 'Edge cluster'
chart installed by the ACS installation process or a locally-defined
equivalent replacement.

The Manager creates a new 'Edge cluster' object in the ConfigDB and uses
this information to create an entry under the 'Edge cluster
configuration' Application. This entry is picked up by the Cluster
Manager service running on the central cluster, which performs the
following steps:

* A 'Sparkplug address information' entry is created for the cluster
  giving the [generated Sparkplug
  Group-ID](./edge-clusters.md#sparkplug-groups).
* A 'Git repository configuration' entry is created for the cluster,
  which makes a new internal Git repo available.
* The new repository is cloned and initialised as described below.
* Accounts are created for the Kerberos Keys and Flux operators which
  will run on the edge.

Information about the progress of this setup is stored in an 'Edge
cluster setup status' entry, so that the process can be picked up again
if the cluster manager is restarted, but the contents of this should be
considered private.

## Bootstrapping at the edge

At this point the Manager will make a link to the bootstrap script for
this cluster available. Clicking the link will copy a shell command to
the clipboard; this will have the form `curl ... | sh -`, and will
download and run a shell script from the central cluster manager. This
script needs to be run by a POSIX shell in an environment where
`kubectl` is available and will contact the target edge cluster by
default. It may be easiest to run the script on one of the machines of
the target cluster but it is not a requirement.

If desired the script may be downloaded and viewed before running it.
Make sure to use the URL provided by the Manager; currently this is in a
fixed format containing the UUID of the cluster, but this may change in
future to include some sort of temporary token. The bulk of the script
is a number of YAML files containing Kubernetes manifests which are
unpacked to a temporary directory; then a small driver script is run
which runs several `kubectl` commands.

The first few commands run a single Pod which pulls the Kerberos Keys
operator container and runs a bootstrap script. This will prompt for
admin credentials; these credentials must have rights to edit principals
in the KDC. The container uses these credentials to create principals
for `krbkeys` itself and for Flux; these link up with the accounts already
created for these principals by the cluster manager. The final step of
creating the principal is performed on the edge as this means the
passwords for the new accounts can be recorded directly to Secrets in
the edge cluster.

After that the script loads installs Flux on the cluster from manifests
and creates the Flux resources which link to the cluster's git repo.
Flux uses the credentials just created to check out the repo and from
that point the state of the cluster is driven by Flux. The repo already
contains manifests instructing Flux to install the 'Edge cluster' Helm
chart, which will deploy the edge operators (`krbkeys`, `sync`, `monitor`) and
the `Sealed Secrets` Helm chart as a sub-chart.

## Status reports from the edge

Once the Edge Sync operator has started up, one of its jobs is to keep
up to date records in the central cluster of the state of the edge
cluster. Specifically, this includes a list of the hosts currently part
of the cluster, along with some information about them, and the current
public key to use to encrypt secret information to the edge. As hosts
are added to or removed from the cluster the operator will update the
'Edge cluster status' application in the ConfigDB; the Manager uses this
information to bring up the list of hosts an Edge Agent can be deployed
to. The sealed secrets operator also periodically renews the keypair to
be used; the edge sync operator periodically uploads the current public
key to the ConfigDB.

The Edge Monitor reports over MQTT. Initially it will simply `NBIRTH`
itself, announcing that the cluster is operational. Once [deployments
have been made](./edge-deployments.md) this will trigger additional
actions from the Monitor.

## Implementation details

This section describes some of the details of the implementation,
hopefully providing the information needed to debug any problems.

The 'Helm chart template' and 'HelmRelease template' ConfigDB
Applications are documented in [the deployment
documentation](./edge-deployments.md#implementation-details). The 'Git
repository configuration' ConfigDB Application is documented in [the Git
server documentation](./git-server.md).

### Edge cluster configuration ConfigDB Application

The 'Edge cluster configuration' Application has UUID
`bdb13634-0b3d-4e38-a065-9d88c12ee78d`. Entries of this type are created
by the Manager or directly by an administrator and are picked up by the
Cluster Manager service. The Object UUID of the entry should be a UUID
generated for the cluster under the 'Edge cluster' class,
`f24d354d-abc1-4e32-98e1-0667b3e40b61`.

Entries of this type should be an object with the following properties:

* `chart`: A UUID referencing a 'Helm chart template' entry to deploy to
  the cluster.
* `name`: A name for the cluster. This will be used to generate the
  associated Sparkplug Group.
* `namespace`: The Kubernetes Namespace to deploy into at the edge.
  Currently the Manager has no support for choosing this.

Entries of this type should not be changed after they have been created;
this is not currently supported. If it is necessary to change the Helm
chart reference, delete the entry, wait for the 'Edge cluster setup
status' entry to disappear, and then recreate it. A deployed cluster
should successfully pick up the change and deploy the new chart. Do not
attempt to change the name of a deployed cluster, this is not possible
as the principals created by the bootstrap would no longer match the
accounts created for the cluster.

### Edge cluster setup status ConfigDB Application

The 'Edge cluster setup status' Application has UUID
`f6c67e6f-e48e-4f69-b4bb-bfbddcc2a517`. Entries of this type are created
and used by the Cluster Manager to track progress setting up the
cluster.

The contents of these entries should be considered undocumented and
private to the Cluster Manager. For the sake of debugging, the Cluster
Manager will set the `ready` property to `true` once it has finished
setup; the bootstrap script for the cluster will not be available until
this has happened.

### Edge cluster status ConfigDB Application

The 'Edge cluster status' Application has UUID
`747a62c9-1b66-4a2e-8dd9-0b70a91b6b75`. Entries of this type are created
by the Edge Sync operator on an edge cluster and used by the Manager and
the Cluster Manager. Existence of an entry of this type indicates the
the edge cluster has been bootstrapped successfully.

Entries of this type will be an object with the following properties.
Properties will only be present once the Edge Sync has been able to
retrieve the relevant information from the cluster.

* `hosts`: An array of objects describing the hosts in the cluster. All
  this information comes from the Node Kubernetes resources on the edge
  cluster. Objects have these properties:

    * `hostname`: The hostname as used by Kubernetes.
    * `control_plane`: A boolean indicating if this host runs the
      Kubernetes cluster control plane services.
    * `k8s_version`: The version of Kubernetes running on this host.
    * `arch`: The CPU architecture.
    * `specialised` (optional): The value of a
      `factoryplus.app.amrc.co.uk/specialised` taint applied to the
      Node.

* `kubeseal_cert`: A string containing the X.509 certificate used to
  encrypt Sealed Secrets for this cluster.

### Bootstrap script ConfigDB Application

The 'Bootstrap script' Application has UUID
`a807d8fc-63ff-48bb-85c7-82b93beb606e` and should have a single entry
with the same UUID. This entry is created by `acs-service-setup` and
used by the Cluster Manager to generate the bootstrap script.

The entry contains templates for some files containing manifests, and a
template for an overall driver script. Some additional files are added
by the Cluster Manager. The files are wrapped up in shell here-docs and
included into the driver script.

### Flux template ConfigDB Application

The 'Flux template' Application has UUID
`72804a19-636b-4836-b62b-7ad1476f2b86` and should have a single entry
with the same UUID. This entry is created by `acs-service-setup` and
used by the Cluster Manager to set up an edge cluster repository.

The entry should be an object mapping file names to Kubernetes manifests
in the form of JSON objects. String values at any level of the form
`{{template}}` will be substituted as follows:

* `namespace`: The Kubernetes namespace to deploy to, from the 'Edge
  cluster configuration' entry.
* `helm`: The generated HelmRelease manifest for the cluster deployment.
* `url`: Git repository URLs:
    * `self`: The repo for this cluster.
    * `helm`: The repo holding the edge Helm charts.
