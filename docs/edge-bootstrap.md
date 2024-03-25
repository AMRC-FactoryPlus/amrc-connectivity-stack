# Edge clusters: Bootstrap process

This document describes the process of setting up a new edge cluster. It
assumes familiarity with [the overall architecture](./edge-clusters.md)
including the data structures used by the ConfigDB. In addition, the
Helm chart templates used are described in full in [the deployment
document](./edge-deployment.md).

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

* Installing approriate Linux and Kubernetes distributions on the
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
in the KDC. 
