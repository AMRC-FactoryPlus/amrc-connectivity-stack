# Edge Cluster helm chart

This is deployed to an edge cluster as part of the bootstrap process.

## Objects needed

### Cluster-specific repo

GitRepo cluster repo
Kust cluster repo
GitRepo flux-system
Kust flux-system
GitRepo for edge Helm charts
HelmRelease for edge cluster helm chart

### Bootstrap requirements

#### Central

op1krbkeys account created and registered correctly
op1flux account created and registered correctly

git repo created and populated

bootstrap script made available

#### Edge

configure host
install k3s

kubectl create namespace $N
kubectl create -f edge-bootstrap.yaml
kubectl attach -ti -n $N edge-bootstrap
kubectl delete -f edge-bootstrap.yaml
kubectl apply -f flux-system.yaml
kubectl apply -f self-link.yaml

### krbkeys cluster bootstrap

    Python 3.11.6 (main, Oct  4 2023, 06:22:18) [GCC 12.2.1 20220924] on linux
    Type "help", "copyright", "credits" or "license" for more information.
    >>> import getpass
    >>> user = input("ACS admin user: ")
    >>> passwd = getpass.getpass(prompt="ACS admin password: ")
    >>> import kadmin
    >>> kadm_h = kadmin.init_with_password(user, passwd)
    >>> import kubernetes as k8s
    >>> from amrc.factoryplus.krbkeys.kadmin import Kadm
    >>> from amrc.factoryplus.krbkeys.kubernetes import K8s
    >>> from amrc.factoryplus.krbkeys.util import KtData
    >>> k8s.config.load_incluster_config()
    >>> k8o = K8s()
    >>> kadm = Kadm(kadm=kadm_h)
    >>> kt = KtData(contents=None)
    >>> with kt.kt_name() as ktname:
    ...   kadm.create_keytab(["op1krbkeys/v3-testing"], ktname)
    ...
    {'op1krbkeys/v3-testing': {'kvno': 2}}
    >>> k8o.update_secret(ns="fplus-edge",name="krb-keys-keytabs",key="client",value=kt.conte
    nts)
    >>> import secrets
    >>> fluxpw = secrets.token_urlsafe()
    >>> kadm.set_password("op1flux/v3-testing", fluxpw)
    {'kvno': 2, 'etypes': ['aes256-cts-hmac-sha1-96:normal', 'aes128-cts-hmac-sha1-96:normal']}
    >>> k8o.update_secret(ns="fplus-edge",name="flux-secrets",key="password",value=fluxpw.encode())
    >>> k8o.update_secret(ns="fplus-edge",name="flux-secrets",key="username",value="op1flux/v3-testing".encode())

### Edge Cluster Helm chart

Namespace fplus-edge

ConfigMap cluster-config
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

Namespace sealed-secrets
sealed-secrets pulled in as a dependency
