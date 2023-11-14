# Edge Cluster helm chart

This is deployed to an edge cluster as part of the bootstrap process.

## Objects needed

### Cluster-specific repo

GitRepo cluster repo
Kust cluster repo
ConfigMap cluster-config
GitRepo for edge Helm charts
HelmRelease for edge cluster helm chart

### Bootstrap requirements

op1krbkeys keytab
op1flux keytab

op1krbkeys account created and registered correctly
op1flux account created and registered correctly

### Edge Cluster Helm chart

Namespace fplus-edge

ConfigMap krb5-conf

ServiceAccount krb-keys
Role krb-keys
RoleBinding krb-keys
ServiceAccount edge-sync
Role edge-sync
RoleBinding edge-sync
ClusterRole acs-nodes-observer
ClusterRoleBinding acs-nodes-observer
ServiceAccount edge-monitor
Role edge-monitor
RoleBinding edge-monitor

CRD KerberosKey
CRD SparkplugNode

KrbKey op1krbkeys
Deployment krb-keys
KrbKey op1flux
KrbKey op1sync
Deployment edge-sync
KrbKey op1monitor
Deployment edge-monitor

### Unknown

Namespace for sealed-secrets

GitRepo flux-system
Kust flux-system
HelmRepo for sealed-secrets
HelmRelease for sealed-secrets

