# Cataloguing SMB shares in OpenMetadata

This document explains how the ACS chart lets OpenMetadata catalogue
files that live on Windows/SMB file shares, what was built to make that
work, and why it was built that way. It finishes with the steps to set
it up and a troubleshooting guide.

Server names, share names, accounts and domains below are placeholders
(`<file-server>`, `<share>`, `<account>`, `<DOMAIN>`). Substitute your
own; never commit real credentials in plain text.

## What it is

OpenMetadata is the data catalogue deployed alongside ACS. A lot of the
data worth cataloguing (CSV exports, test results, reports) lives on
departmental SMB/CIFS file shares, but **OpenMetadata has no SMB
connector**. Its closest equivalent is the **SFTP Drive connector**
(beta), which catalogues directories and files, and reads the schema and
sample rows of CSV/TSV files.

The *SMB bridge* (`openmetadataSmb` in `deploy/values.yaml`) closes that
gap. It mounts each configured SMB share read-only inside the cluster
and re-exposes it over SFTP, so OpenMetadata's existing SFTP connector
can catalogue it as if it were an SFTP server.

```
SMB file server ──(CIFS, TCP 445)──> csi-driver-smb ──> openmetadata-sftp pod
                                                            │  /shares/<name>
OpenMetadata SFTP connector ──(SFTP, port 22, in-cluster)───┘
```

## Why this approach

Options considered:

- **Write a custom SMB connector for OpenMetadata.** Most flexible, but
  means maintaining a Python ingestion plugin against a fast-moving
  upstream API, and rebuilding the ingestion image.
- **Copy files from the share into object storage** (e.g. MinIO/S3) and
  catalogue that. Duplicates data, needs a sync job, and the catalogue
  would describe the copy rather than the source of truth.
- **Bridge SMB to a protocol OpenMetadata already speaks (chosen).**
  No custom code in OpenMetadata, no data copied, and the catalogue
  reflects the live share. It uses two off-the-shelf, maintained
  components and plain Kubernetes resources.

Other decisions:

- **Read-only end to end.** The share is mounted `ro` with read-only
  file/directory modes, the PersistentVolume and claim are
  `ReadOnlyMany`, and the volume is mounted read-only in the pod. The
  catalogue can never modify the source files.
- **In-cluster only.** The SFTP server is exposed by a `ClusterIP`
  Service; nothing is reachable from outside the cluster.
- **Credentials kept out of Git.** The SMB login is read from a
  Kubernetes Secret. It can be supplied as a
  [Sealed Secret](https://github.com/bitnami-labs/sealed-secrets)
  (encrypted, safe to commit in a values file) or created by hand.
- **Off by default.** Nothing is deployed unless both `openmetadata` and
  `openmetadataSmb` are enabled.

## What has been done

### Helm chart: the bridge (`deploy/templates/openmetadata/smb-bridge.yaml`)

For each entry in `openmetadataSmb.shares` the chart creates:

- a **PersistentVolume** using the `smb.csi.k8s.io` driver, pointing at
  the share's UNC path and authenticating with the credentials Secret.
  PVs are cluster-scoped, so the name includes the release namespace
  (`<namespace>-openmetadata-smb-<name>`);
- a **PersistentVolumeClaim** (`openmetadata-smb-<name>`) bound to it.

And once per release:

- an **`openmetadata-sftp` Deployment** running
  [linuxserver/openssh-server](https://github.com/linuxserver/docker-openssh-server),
  with each share mounted read-only at `/shares/<name>` and a single SFTP
  user, `openmetadata`;
- an **`openmetadata-sftp` Service** on port 22 (forwarding to the
  container's 2222);
- an **`openmetadata-sftp` Secret** holding a random 32-character SFTP
  password. It is generated only if it doesn't already exist and is
  marked `helm.sh/resource-policy: keep`, so the password stays stable
  across upgrades and the OpenMetadata connection doesn't break.

The SSH host key is regenerated on each pod restart. That's acceptable
because OpenMetadata's SFTP connector doesn't verify host keys, and it
avoids storing another secret.

### Helm chart: SMB CSI driver dependency (`deploy/Chart.yaml`)

[csi-driver-smb](https://github.com/kubernetes-csi/csi-driver-smb) is
added as a subchart, installed when `openmetadataSmb.enabled` is true.
Its `CSIDriver` object and ClusterRoles are cluster-wide, so only one
Helm release per cluster can own them. If the cluster already has the
driver, set `csi-driver-smb.enabled: false`. Windows node support is
disabled.

### Helm chart: sealed credentials (`deploy/templates/openmetadata/smb-credentials.yaml`)

If `openmetadataSmb.sealedCredentials` is set, the chart creates a
`SealedSecret` which the sealed-secrets controller decrypts into the
credentials Secret (`openmetadataSmb.credentialsSecret`, default
`openmetadata-smb-creds`) with keys `username`, `password` and,
optionally, `domain`. If it isn't set, the Secret must be created by
hand before the upgrade.

### Values (`deploy/values.yaml`)

```yaml
openmetadataSmb:
  enabled: false
  credentialsSecret: openmetadata-smb-creds
  sealedCredentials: {}      # username / password / domain, sealed
  shares: []                 # - name: <name>
                             #   source: //<file-server>/<share>/<folder>
  mountOptions: [ro, dir_mode=0555, file_mode=0444, uid=1000, gid=1000]
  sftp:
    image: linuxserver/openssh-server (pinned tag)

csi-driver-smb:
  # enabled: false           # set if the cluster already has the driver
```

## Setting it up

### Prerequisites

- OpenMetadata enabled in the ACS release (`openmetadata.enabled` and
  `openmetadata-dependencies.enabled`).
- Every cluster node can reach the file server on TCP 445 and has the
  `cifs` kernel module (standard on most distributions).
- A service account with **read** access to the share.

### 1. Find the real share path

Use the file server's own share, **not** a DFS namespace path such as
`//<domain>/<namespace>/<folder>`. A DFS link's target name often
doesn't match the real share name, and following the referral fails
with `NT_STATUS_BAD_NETWORK_NAME`.

```sh
smbclient -L //<file-server> -U '<DOMAIN>\<account>' -m SMB3
smbclient //<file-server>/<share> -U '<DOMAIN>\<account>' -m SMB3 -c 'ls <folder>/*'
```

The share `source` is the UNC path with forward slashes:
`//<file-server>/<share>/<folder>`.

### 2. Check for an existing SMB CSI driver

```sh
helm list -A | grep csi-driver-smb
kubectl get csidriver smb.csi.k8s.io
```

If either returns something, set `csi-driver-smb.enabled: false` in
step 4 and confirm the existing driver has a `csi-smb-node` pod running
on every schedulable node:

```sh
kubectl -n kube-system get pods -l 'app in (csi-smb-controller,csi-smb-node)'
```

### 3. Provide the SMB credentials

Read the password without echoing it, so it stays off screen and out of
shell history (zsh: `read -rs "SMB_PASS?SMB password: "`; bash:
`read -rsp "SMB password: " SMB_PASS`).

**3a. Sealed secret (recommended).** Requires the sealed-secrets
controller on the cluster and `kubeseal` locally.

```sh
kubeseal --fetch-cert > sealed-secrets-cert.pem   # public, but don't commit it

seal () {
  printf '%s' "$1" | kubeseal --raw --cert sealed-secrets-cert.pem \
    --namespace <namespace> --name openmetadata-smb-creds
  echo
}
seal '<account>'
seal "$SMB_PASS"
seal '<DOMAIN>'
unset SMB_PASS
```

A sealed value only decrypts into a Secret with the same name and
namespace, so these must match `openmetadataSmb.credentialsSecret` and
the release namespace. Put the outputs under
`openmetadataSmb.sealedCredentials.{username,password,domain}`.

If the Secret was previously created by hand, let the controller adopt
it:

```sh
kubectl -n <namespace> annotate secret openmetadata-smb-creds \
  sealedsecrets.bitnami.com/managed=true
```

**3b. Create the Secret by hand** (quick tests only). Leave
`sealedCredentials` unset:

```sh
kubectl create secret generic openmetadata-smb-creds -n <namespace> \
  --from-literal=username='<account>' \
  --from-file=password=<(printf '%s' "$SMB_PASS") \
  --from-literal=domain='<DOMAIN>'
unset SMB_PASS
```

After changing credentials either way, restart the bridge so the share
is remounted:

```sh
kubectl -n <namespace> rollout restart deploy/openmetadata-sftp
```

### 4. Enable the bridge

```yaml
openmetadataSmb:
  enabled: true
  shares:
    - name: <name>
      source: //<file-server>/<share>/<folder>

# Only if the cluster already has csi-driver-smb (step 2). Top level.
csi-driver-smb:
  enabled: false
```

Then upgrade the release as usual. A share's `source` and the
`mountOptions` are immutable on the PV: to change them, delete the PV
and PVC first, then upgrade again.

### 5. Check the mount

```sh
kubectl -n <namespace> get pods -l component=openmetadata-sftp
kubectl -n <namespace> exec deploy/openmetadata-sftp -- ls /shares/<name>
```

### 6. Add the SFTP service in OpenMetadata

Fetch the generated SFTP password:

```sh
kubectl -n <namespace> get secret openmetadata-sftp -o jsonpath='{.data.password}' | base64 -d; echo
```

In OpenMetadata go to **Settings → Services → Drive → Add New Service →
SFTP**:

| Field            | Value                                          |
| ---------------- | ---------------------------------------------- |
| Host             | `openmetadata-sftp`                            |
| Port             | `22`                                           |
| Auth             | Username/Password: `openmetadata` + the above  |
| Root Directories | `/shares/<name>` (or `/shares` for all shares) |

Test the connection, then add a metadata ingestion pipeline with a
schedule.

## Troubleshooting

**SFTP pod stuck in `ContainerCreating`.** The share failed to mount;
see `kubectl -n <namespace> describe pod -l component=openmetadata-sftp`.

| Event message                                   | Cause                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `secret "openmetadata-smb-creds" not found`     | Credentials not provided, or the SealedSecret didn't decrypt (check its status).   |
| `Permission denied` / `STATUS_LOGON_FAILURE`    | Wrong username, password or domain.                                                |
| `NT_STATUS_BAD_NETWORK_NAME` / `No such file`   | `source` is a DFS path or misspelt (step 1).                                       |
| `Host is down` / timeouts                       | Node can't reach the file server on TCP 445.                                       |
| `driver name smb.csi.k8s.io not found`          | No `csi-smb-node` pod on that node (step 2).                                       |

A SealedSecret fails to decrypt if it was sealed for a different name or
namespace, or with another cluster's certificate.

**Upgrade fails with an ownership error on `smb-*` ClusterRoles.** The
cluster already has csi-driver-smb. Set `csi-driver-smb.enabled: false`
and upgrade again.

**Connection test fails in OpenMetadata.** Check the SFTP pod is
`Ready`, the host is `openmetadata-sftp`, and the port is `22` (the
Service port, not the container's 2222).
