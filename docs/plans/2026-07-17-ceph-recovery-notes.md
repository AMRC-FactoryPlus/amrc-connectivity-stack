# fpd-jahx Ceph recovery: research notes (2026-07-17)

PARTIAL. One of four research agents completed before the session token limit; the
runbook draft and the three adversarial reviews never ran. Treat this as verified
research, NOT as an executable runbook. Re-run the workflow at
scratchpad/ceph-recovery-plan.js (resume wf_d9349229-7ee) to finish it.

## Situation

k3s state wiped 2026-06-05; Ceph itself untouched. Survived on all 3 nodes:
cluster fsid 0fbfc870-3ee0-4908-a7a6-be512830df66, client.admin.keyring,
rook-ceph.config, the OSD dirs, all 3 mon stores on local-path (mon-r jahx /
mon-k xag / mon-q rvs, 64M each), all 3 /dev/sdb live bluestore.
Was running Ceph 19.2.3 squid under Rook 1.19.5. Latest chart today is 1.20.2.

## Summary

Your data is very likely recoverable, and the good news is that Rook will NOT touch /dev/sdb by default — I traced the zap path to a single gate in Rook's source (`spec.cleanupPolicy.wipeDevicesFromOtherClusters`, default false). Leave it unset and the worst case is Rook logs "skipping osd.N: belonging to a different ceph cluster" and does nothing.

CRITICAL CORRECTION TO THE PLAN: do NOT use the Rook doc's "Adopt an existing Rook Ceph cluster into a new Kubernetes cluster" procedure. It is the wrong flow for you and its step 4 is "Remove /var/lib/rook from all the Rook Ceph nodes" — that deletes your admin keyring, your fsid record, AND your OSD keyring dirs. It also deliberately runs a fresh cluster under a NEW random fsid for several steps, which is precisely the state that arms the zap path. It was written in the Ceph v14 era for a case where you have no surviving metadata.

Use instead "Restoring the Rook cluster after the Rook namespace is deleted". Your situation IS that case: dataDirHostPath survived on all three nodes and the OSD disks are intact. That flow never lets a wrong fsid exist, because you hand-create the `rook-ceph-mon` Secret carrying the ORIGINAL fsid *before* the operator ever reconciles. Only TWO objects need hand-creating (Secret `rook-ceph-mon`, ConfigMap `rook-ceph-mon-endpoints`); I verified in `cluster_info.go` that everything else — rook-ceph-config, rook-ceph-admin-keyring, the CSI secrets, the mon Services — is derived automatically.

The single most valuable surviving file is /var/lib/rook/rook-ceph/rook-ceph.config. Its `mon host` line holds the ORIGINAL mon ClusterIPs. Recreate the endpoints ConfigMap with those exact IPs and Rook recreates the mon Services with the same ClusterIPs, so the monmap inside the surviving stores stays valid and you need NO monmap surgery at all. That is the difference between a 30-minute restore and a day of ceph-monstore-tool work.

BIGGEST RISK IS NOT ZAPPING — IT IS VERSION DRIFT. Because Flux pinned nothing, today's "latest" Rook is v1.19.x, whose `Minimum` constant is Ceph 19.2.0. It will hard-refuse Reef 18.x. And your OSD's "18.2.1" string is creation-time only (Jan 2024) — I reconstructed the chart-default drift and the cluster was almost certainly running Squid 19.2.x by June 2026. You MUST establish the real running version forensically before deploying anything; I give four independent read-only ways to do it.

## Use the 'namespace deleted' flow, NOT the 'adopt into new Kubernetes cluster' flow

The disaster-recovery page contains TWO candidate procedures and picking the wrong one is destructive.

'Adopt an existing Rook Ceph cluster into a new Kubernetes cluster' (26 steps) is WRONG FOR YOU:
  - Step 4 verbatim: 'Remove /var/lib/rook from all the Rook Ceph nodes.' That destroys client.admin.keyring, rook-ceph.config (your only record of fsid + mon IPs), and the <fsid>_<osd-fsid>/ dirs holding the OSD keyrings and the `block` symlink to /dev/sdb.
  - Step 5 tells you to set mon.count=1 and bring up a CLEAN cluster first. A clean cluster mints a NEW random fsid (cluster_info.go:213 `fsid, err := uuid.NewRandom()`). For steps 5-15 the cluster's fsid != the disks' fsid — exactly the condition the zap path tests. Its step 9 reassures you 'Rook should not start any OSD daemon since all devices belongs to the old cluster (which have a different fsid)'; that prose predates the WipeDevicesFromOtherClusters feature and the example image tag is `ceph/ceph:v14.2.1-20190430` (2019).
  - It then requires monmap surgery (monmaptool --rm / --addv) because the fresh mon has a new ClusterIP.

'Restoring the Rook cluster after the Rook namespace is deleted' is the RIGHT flow. Its opening line matches your forensics exactly: 'With the content in the directory dataDirHostPath and the original OSD disks, the ceph cluster could be restored with this guide.' You hand-craft the Secret + ConfigMap with the ORIGINAL fsid and ORIGINAL mon IPs, then deploy. The cluster is never wrong-fsid at any instant, and no monmap surgery is needed.

Documented order:
  1. Craft Secret rook-ceph-mon (values from dataDirHostPath).
  2. Craft ConfigMap rook-ceph-mon-endpoints (values from rook-ceph.config).
  3. `kubectl create -f crds.yaml -f common.yaml -f operator.yaml`
  4. After the operator is running: `kubectl create -f rook-ceph-mon.yaml -f rook-ceph-mon-endpoints.yaml`
  5. `kubectl create -f cluster.yaml`

ORDERING SUBTLETY THE DOC GLOSSES: the doc creates the operator before the Secret. That is safe only because no CephCluster CR exists yet — with no CR the operator has nothing to reconcile and cannot mint an fsid. Since you use Flux/Helm, a single `flux reconcile` could apply the operator AND the CephCluster together, racing the Secret. Create the Secret and ConfigMap FIRST, and keep the CephCluster CR out of the cluster until they exist and you have verified them.

Sources: https://rook.io/docs/rook/latest/Troubleshooting/disaster-recovery/ ; https://raw.githubusercontent.com/rook/rook/master/Documentation/Troubleshooting/disaster-recovery.md (lines 144-251 adopt flow, 271-363 namespace-deleted flow) ; https://github.com/rook/rook/blob/master/pkg/operator/ceph/controller/cluster_info.go#L213

## What makes Rook ZAP vs ADOPT — traced to one CR field, default false

I traced the whole path. There is exactly ONE way Rook destroys an OSD disk that belongs to a different cluster, and it is opt-in.

CALL CHAIN:
  CephCluster spec.cleanupPolicy.wipeDevicesFromOtherClusters: true
    -> provision_spec.go:208  `if c.spec.CleanupPolicy.WipeDevicesFromOtherClusters {` adds env var
    -> envs.go:54             ROOK_WIPE_DEVICES_FROM_OTHER_CLUSTERS=true on the osd-prepare job
    -> cmd/rook/ceph/osd.go:106  flag `--wipe-devices-from-other-clusters`, DEFAULT false
    -> daemon.go:205          `if agent.wipeDevicesFromOtherClusters { ... WipeDevicesFromOtherClusters(context) }`
    -> volume.go:999          `if existingOSD.CephFsid != a.clusterInfo.FSID {` -> ZapDevice()
    -> volume.go:917-955      ZapDevice = `ceph-volume lvm zap` THEN `ceph-bluestore-tool zap-device --dev <dev> --yes-i-really-really-mean-it`

The CR field (types.go:3523-3526): 'WipeDevicesFromOtherClusters wipes the OSD disks belonging to other clusters. This is useful in scenarios where ceph cluster was reinstalled but OSD disk still contains the metadata from previous ceph cluster.' It is NOT documented on the CephCluster CRD web page — it exists only in the Go types and the generated specification.md. That makes it easy to enable by cargo-culting a StackOverflow answer. DO NOT.

WITH THE FLAG UNSET (your GitOps cluster.yaml has no cleanupPolicy block at all), the adopt path is:
  - osd-prepare runs `ceph-volume raw list --format json`
  - it finds /dev/sdb with its bluestore label and ceph_fsid
  - if ceph_fsid == cluster fsid -> ADOPT: logs 'Raw device /dev/sdb is already prepared', activates the existing OSD, no write to data
  - if ceph_fsid != cluster fsid -> SKIP: logs 'skipping osd.N: belonging to a different ceph cluster'. Non-destructive. Confirmed by real-world report #15937, where a user could NOT get Rook to reuse the disk even though they wanted to — Rook's failure mode is refusing, not wiping.

So adoption is decided purely by fsid equality against the bluestore label on /dev/sdb. Getting `fsid` right in the rook-ceph-mon Secret IS the whole game.

MUST NEVER SET:
  - cleanupPolicy.wipeDevicesFromOtherClusters: true   -> zaps /dev/sdb
  - cleanupPolicy.confirmation: yes-really-destroy-data -> the uninstall nuke
  - storage.useAllDevices: true                         -> claims disks (yours correctly says false; the comment in your repo already warns 'DO NOT CHANGE THIS')
  - --force-format / forceFormat

NOTE ON A DEFENCE THAT DOES NOT WORK: I checked whether omitting sdb from storage.nodes would protect it via the 'skip wiping ... since not a desired device' branch (volume.go:1025). It does NOT — getOSDDiskToBeWiped iterates context.Devices, which daemon.go:195-202 sets from DiscoverDevicesWithFilter, i.e. ALL host disks, not just spec'd ones. Omitting the nodes from the spec still helps, but for a different reason: with useAllNodes:false and storage.nodes:[] Rook creates NO osd-prepare job at all, so the wipe code never executes. That is a legitimate staging tactic for the risky bootstrap window.

Sources: https://github.com/rook/rook/blob/master/pkg/apis/ceph.rook.io/v1/types.go#L3523-L3526 ; https://github.com/rook/rook/blob/master/pkg/operator/ceph/cluster/osd/provision_spec.go#L208 ; https://github.com/rook/rook/blob/master/pkg/operator/ceph/cluster/osd/envs.go#L54 ; https://github.com/rook/rook/blob/master/cmd/rook/ceph/osd.go#L106 ; https://github.com/rook/rook/blob/master/pkg/daemon/ceph/osd/daemon.go#L205 ; https://github.com/rook/rook/blob/master/pkg/daemon/ceph/osd/volume.go#L917-L1028 ; https://github.com/rook/rook/issues/15937

## Exactly two objects must be hand-created — everything else is derived

I read LoadClusterInfo to settle this rather than trusting the doc. The operator reads exactly TWO objects to bootstrap its identity:
  - Secret `rook-ceph-mon`            (cluster_info.go:109, via const AppName)
  - ConfigMap `rook-ceph-mon-endpoints` (cluster_info.go:289 and :312)

Secret keys actually read (cluster_info.go:51-56, 131-138):
  - fsid          (fsidSecretNameKey)  <- REQUIRED
  - mon-secret    (MonSecretNameKey)   <- REQUIRED
  - ceph-username (CephUsernameKey)    <- 'client.admin'
  - ceph-secret   (CephUserSecretKey)  <- the client.admin key
  - admin-secret  (AdminSecretNameKey) <- DEPRECATED, DO NOT USE. It is a legacy/external-cluster path; if present and set to the literal 'admin-secret' the operator goes looking for a separate `rook-ceph-operator-creds` Secret (cluster_info.go:174-180). Answering your question directly: use fsid + mon-secret + ceph-username + ceph-secret, and omit admin-secret entirely.

DO NOT hand-create these — the operator makes them and hand-made ones will fight it:
  - Secret rook-ceph-config, Secret rook-ceph-admin-keyring, Secret rook-ceph-mons-keyring: derived from rook-ceph-mon.
  - Secrets rook-csi-rbd-provisioner / rook-csi-rbd-node: created by CreateCSISecrets (csi/secrets.go:236) which runs `ceph auth get-or-create` for users client.csi-rbd-provisioner and client.csi-rbd-node (csi/secrets.go:42-45). Those users ALREADY EXIST in the auth database inside your surviving mon stores, so get-or-create returns the existing keys and Rook rewrites the Secrets automatically. Your RBD StorageClass references these by name and will work again with no manual step. This answers your CSI question: nothing to do.
  - The mon Services: Rook creates them FROM the ConfigMap. This is the mechanism that restores the original ClusterIPs.

SECRET YAML (fsid + username already base64'd for you):

apiVersion: v1
kind: Secret
metadata:
  name: rook-ceph-mon
  namespace: rook-ceph
  finalizers:
    - ceph.rook.io/disaster-protection
type: kubernetes.io/rook
data:
  fsid: MGZiZmM4NzAtM2VlMC00OTA4LWE3YTYtYmU1MTI4MzBkZjY2
  ceph-username: Y2xpZW50LmFkbWlu
  ceph-secret: <base64 of the client.admin key>
  mon-secret: <base64 of the mon. key>

CONFIGMAP YAML (mon ids r/k/q; IPs come from rook-ceph.config `mon host`):

apiVersion: v1
kind: ConfigMap
metadata:
  name: rook-ceph-mon-endpoints
  namespace: rook-ceph
  finalizers:
    - ceph.rook.io/disaster-protection
data:
  data: "r=<IP_r>:6789,k=<IP_k>:6789,q=<IP_q>:6789"
  csi-cluster-config-json: '[{"clusterID":"rook-ceph","monitors":["<IP_r>:6789","<IP_k>:6789","<IP_q>:6789"],"namespace":""}]'
  mapping: '{"node":{"r":{"Name":"amrc-fpd-jahx","Hostname":"amrc-fpd-jahx","Address":"<node_ip_jahx>"},"k":{"Name":"amrc-fpd-xag","Hostname":"amrc-fpd-xag","Address":"<node_ip_xag>"},"q":{"Name":"amrc-fpd-rvs","Hostname":"amrc-fpd-rvs","Address":"<node_ip_rvs>"}}}'
  maxMonId: "17"

FIELD SEMANTICS:
  - `data`: comma-separated <monid>=<mon ClusterIP>:6789. v1/msgr1 port. Rook derives the v2/3300 endpoint itself.
  - `mapping`: tells Rook WHICH NODE to schedule each mon pod on. Your mon stores are node-local (r on jahx, k on xag, q on rvs), so getting this wrong schedules a mon onto a node with no store. Name/Hostname must be the k8s node name; the doc's example uses IPs only because that cluster's node names WERE IPs.
  - `maxMonId`: 0-based letter index of the highest mon id. r = ord('r')-ord('a') = 17. Set "17". It only governs the NEXT mon name to allocate; too high is harmless, too low risks a name collision.
  - The `ceph.rook.io/disaster-protection` finalizer is what stops these two objects being garbage-collected. Keep it — it is the thing that would have saved you here.

Sources: https://github.com/rook/rook/blob/master/pkg/operator/ceph/controller/cluster_info.go#L51-L56,#L109,#L131-L138,#L174-L180,#L289,#L312 ; https://github.com/rook/rook/blob/master/pkg/operator/ceph/csi/secrets.go#L42-L45,#L236 ; https://raw.githubusercontent.com/rook/rook/master/Documentation/Troubleshooting/disaster-recovery.md (lines 277-341)

## Where the key values come from — and the mon. secret question answered

fsid — you already have it: 0fbfc870-3ee0-4908-a7a6-be512830df66, in /var/lib/rook/rook-ceph/rook-ceph.config under [global]. Base64: MGZiZmM4NzAtM2VlMC00OTA4LWE3YTYtYmU1MTI4MzBkZjY2

client.admin key -> ceph-secret — from /var/lib/rook/rook-ceph/client.admin.keyring, which looks like:
  [client.admin]
          key = AQxxxxxxxxxxxxxxxxxxxxxxxxxxxx==
Take ONLY the value after 'key = '. The rook-ceph-mon Secret stores the BARE KEY STRING, not the keyring block — I confirmed this by base64-decoding the doc's own example: ceph-secret decodes to `AQBgHzVj+qSaHhAAumVKMr7+s3NYoNkjlbA+KA==` with no [client.admin] header.

mon. key -> mon-secret — THIS IS YOUR OPEN QUESTION, and the doc is misleading here. The doc says 'ceph-secret and mon-secret are to be filled with the client.admin's keyring contents', and its example uses the IDENTICAL base64 for both. That is a simplification that works when Rook is CREATING new mons (mon-secret seeds a fresh mon keyring). You are RESTORING three existing mon stores whose auth database already contains the real, different mon. key. Mons authenticate to each other with the mon. key, so a wrong value risks mons failing to form quorum under cephx.

Use the REAL mon. key. It survives on disk: Ceph's mon data directory contains a `keyring` file holding the [mon.] private key, alongside store.db. Your mon_data dir is the `data/` subdir of each mon PVC dir (this is exactly the layout the adopt doc assumes when it runs `ceph-mon --extract-monmap monmap --mon-data ./mon-a/data`). So look for:
  /var/lib/rancher/k3s/storage/pvc-4b49a7d0-..._rook-ceph_rook-ceph-mon-r/data/keyring
and its siblings on xag (mon k) and rvs (mon q). All three should carry the same mon. key. It looks like:
  [mon.]
          key = AQxxxxxxxxxxxxxxxxxxxxxxxxxxxx==
          caps mon = "allow *"
Take only the value after 'key = '.

Remember /var/lib/rancher/k3s/storage is 0700 root-only, so globs must run under `sudo sh -c '...'` as you noted.

FALLBACKS if data/keyring is absent or unreadable (in order of preference):
  1. `ceph-monstore-tool <mon_data> dump-keys` — dumps the auth database from the store offline, including the mon. entry. Run it inside a ceph container of the MATCHING version against a COPY of the store, never the original.
  2. Follow the doc literally and put the admin key in mon-secret. If mons then form quorum, you are fine (they may read their key from their own store). If they fail cephx, fall back to 3.
  3. Temporarily disable auth exactly as the adopt doc step 16 does (edit cm/rook-config-override, set `auth cluster required = none` / `auth service required = none` / `auth client required = none` / `auth supported = none`), bring the cluster up, then `ceph auth import -i key` the admin key back and re-enable auth (adopt doc steps 20-21). This is the documented escape hatch and it is the reason the adopt flow disables auth at all.

MON IPs -> the ConfigMap — THE MOST IMPORTANT SURVIVING DATA. rook-ceph.config's [global] block has, per the doc's worked example:
  mon initial members = m o k
  mon host            = [v2:169.169.82.57:3300,v1:169.169.82.57:6789],[v2:169.169.7.81:3300,v1:169.169.7.81:6789],[v2:169.169.241.153:3300,v1:169.169.241.153:6789]
The doc: 'mon initial members and mon host are holding sequences of monitors' id and IP respectively; the sequence are going in the same order among monitors as a result you can tell which monitors have which service IP addresses.' So zip the two lists positionally to map r/k/q -> IP. Your file is 319 bytes and already confirmed to contain the fsid, so it will contain these lines too.

WHY THIS MATTERS SO MUCH: the doc explains 'The Monitor's service IPs are kept in the monitor data store and you need to create them by original ones. After you create this configmap with the original service IPs, the rook operator will create the correct services for you with IPs matching in the monitor data store.' Reuse the original ClusterIPs and the monmap inside your surviving stores is still correct -> quorum forms immediately -> zero monmap surgery. This only works if the new k3s cluster's service CIDR still contains those IPs (k3s default 10.43.0.0/16). VERIFY THAT BEFORE ANYTHING ELSE — if the CIDR changed, or those IPs are already allocated to other Services, you fall back to monmap surgery per adopt-doc step 14.4.

Sources: https://raw.githubusercontent.com/rook/rook/master/Documentation/Troubleshooting/disaster-recovery.md (lines 196-213 keyring/monmap, 297-341 value sources) ; https://docs.ceph.com/en/latest/man/8/ceph-monstore-tool/ ; https://docs.ceph.com/en/reef/rados/troubleshooting/troubleshooting-mon/ ; https://docs.ceph.com/en/reef/man/8/ceph-authtool/

## VERSION PINNING — the largest real risk, and 18.2.1 is a red herring

I built the matrix from Rook's own source rather than release notes. `Minimum` is a hard error; `supportedVersions` is a soft error overridable by allowUnsupported (cluster/version.go:123-137):
  if !version.IsAtLeast(cephver.Minimum) { return errors.Errorf("the version does not meet the minimum version %q") }   <- HARD FAIL, no override
  if !version.Supported() { if !c.Spec.CephVersion.AllowUnsupported { return errors.Errorf("allowUnsupported must be set to true to run with this version %q") } }  <- overridable

 rook  | Minimum | supportedVersions          | chart default cephVersion.image | released
 -------|---------|----------------------------|---------------------------------|------------
 v1.13 | 17.2.0  | Quincy, Reef               | quay.io/ceph/ceph:v18.2.2       | 2023-12-13
 v1.14 | 17.2.0  | Quincy, Reef               | quay.io/ceph/ceph:v18.2.4       | 2024-04-03
 v1.15 | 17.2.0  | Quincy, Reef, Squid        | quay.io/ceph/ceph:v18.2.4       | 2024-08-20
 v1.16 | 18.2.0  | Reef, Squid                | quay.io/ceph/ceph:v19.2.2       | 2024-12-17
 v1.17 | 18.2.0  | Reef, Squid                | quay.io/ceph/ceph:v19.2.3       | 2025-04-16
 v1.18 | 18.2.0  | Reef, Squid, Tentacle      | quay.io/ceph/ceph:v19.2.3       | 2025-08-20
 v1.19 | 19.2.0  | Squid, Tentacle            | (n/a)                           | 2026-01-20

TWO CONSEQUENCES:

1. YOUR OSD's '18.2.1' IS CREATION-TIME ONLY AND ALMOST CERTAINLY NOT WHAT WAS RUNNING. Your suspicion is right. Cluster created Jan 2024 = Rook v1.13 era (chart default 18.2.2, consistent). Flux pinned nothing and reconciled every 5m for ~2.5 years, so it tracked Rook latest continuously. When Rook v1.16 landed 2024-12-17 the chart's DEFAULT cephVersion.image jumped 18.2.4 -> 19.2.2. Since you never override cephVersion, that default applied, and Reef->Squid is a legal single-major jump that Rook would have performed automatically. By 2026-06-01 the cluster was very probably on Ceph 19.2.x (Squid) under Rook v1.18.x. Plan for Squid; verify before acting.

2. TODAY'S LATEST ROOK CANNOT OPEN REEF DATA. It is now 2026-07-17, so 'latest' resolves to Rook v1.19.x, Minimum 19.2.0. If the data really is Reef 18.x, v1.19 hard-fails with 'the version does not meet the minimum version' and allowUnsupported CANNOT override it. Silver lining: this is a refusal, not a wipe — it fails safe.

PIN BOTH, ALWAYS. Add to the HelmRelease: spec.chart.spec.version: <exact rook>, and to cephClusterSpec: cephVersion.image: quay.io/ceph/ceph:<exact tag> plus `imagePullPolicy: IfNotPresent`. The CRD doc explicitly warns against floating tags: avoid general tags like `v19` which update with new releases, causing version inconsistency across nodes.

SELECTION RULE once you know the running version V:
  - V = 19.2.x (most likely) -> pin rook chart v1.18.11, cephVersion.image quay.io/ceph/ceph:v19.2.3. v1.18 supports Reef+Squid+Tentacle, so it is the most forgiving choice and also gives you a v1.19 upgrade path later.
  - V = 18.2.x            -> pin rook chart v1.15.9, cephVersion.image quay.io/ceph/ceph:<your exact 18.2.x>. v1.15 has Minimum 17.2.0 and supports Reef. Do NOT use v1.19.
  - V = 20.x (unlikely)   -> pin rook chart v1.18.11 or v1.19.7 with image v20.x.
Always pin the image to the EXACT tag you find running, never a newer one. Bring the cluster up on its own version first; do any upgrade as a separate, deliberate, later exercise once your data is exported.

Sources: https://github.com/rook/rook/blob/v1.19.7/pkg/operator/ceph/cluster/version.go#L123-L137 ; https://github.com/rook/rook/blob/v1.19.7/pkg/operator/ceph/version/version.go#L43-L55 ; https://github.com/rook/rook/blob/v1.18.11/pkg/operator/ceph/version/version.go#L43-L58 ; https://github.com/rook/rook/blob/v1.16.9/pkg/operator/ceph/version/version.go#L43-L55 ; https://github.com/rook/rook/blob/v1.15.9/pkg/operator/ceph/version/version.go#L43-L58 ; https://rook.io/docs/rook/latest/CRDs/Cluster/ceph-cluster-crd/

## skipUpgradeChecks / continueUpgradeAfterChecksEvenIfNotHealthy — do you need them?

Direct answer: you should NOT need any of them, and you should NOT set them, PROVIDED you pin cephVersion.image to the version that was actually running. All three flags only gate the UPGRADE path. If the spec image == the running version, there is no upgrade, so there are no checks to skip. Setting them is treating a symptom you do not have.

  - skipUpgradeChecks (default false): 'if set to true Rook won't perform any upgrade checks on Ceph daemons during an upgrade.' Doc's own words: 'Use this at YOUR OWN RISK, only if you know what you're doing.' The checks it disables are the ones that stop Rook restarting mon #2 while mon #1 is still out of quorum. On a 3-mon cluster you are restoring, those checks are precisely what protects you from losing quorum mid-restore. LEAVE FALSE.
  - continueUpgradeAfterChecksEvenIfNotHealthy (default false): 'if set to true Rook will continue the OSD daemon upgrade process even if the PGs are not clean.' This is the one that is superficially tempting, because your cluster WILL start unhealthy — PGs will be degraded/peering while OSDs come up. Do not reach for it. Your cluster starting unhealthy is NOT an upgrade scenario; the flag has no effect unless an upgrade is in flight. If you find yourself wanting it, that is a signal your cephVersion.image is wrong and Rook is trying to upgrade when it should not be. Fix the pin instead. Setting it while Rook is mid unintended-major-upgrade would let Rook restart OSDs across a version boundary on unhealthy PGs — a genuine way to lose data.
  - upgradeOSDRequiresHealthyPGs (default false): protective, blocks OSD upgrade until PGs healthy. Harmless. Not needed if not upgrading.
  - cephVersion.allowUnsupported (default false): only overrides the SOFT `supportedVersions` check, NEVER the hard `Minimum` check. Doc: 'Should be set to false in production.' Only relevant if you land on a Rook whose supportedVersions omits your version — the right fix is to choose a different Rook, not to force it.

EXPECTED HEALTHY-ISH STATES DURING RESTORE (do not panic, do not add flags):
  - mons forming quorum: brief HEALTH_WARN.
  - OSDs booting: PGs peering -> degraded -> active+clean. With replicated size:2 across 3 hosts, full recovery should be quick on a test dataset.
  - 'mon is allowing insecure global_id reclaim' and clock-skew warnings are normal and cosmetic.
What is NOT normal and means STOP: 'skipping osd.N: belonging to a different ceph cluster' (your fsid is wrong — fix the Secret, do not force anything), or 'the version does not meet the minimum version' (your Rook is too new — pin lower).

Sources: https://rook.io/docs/rook/latest/CRDs/Cluster/ceph-cluster-crd/ ; https://github.com/rook/rook/blob/v1.19.7/pkg/operator/ceph/cluster/version.go#L123-L137

## The mon-store-on-PVC wrinkle the docs do not cover

Neither documented flow matches you exactly. The 'namespace deleted' flow assumes mon data at dataDirHostPath/mon-<id>. Yours is on local-path PVCs (mon volumeClaimTemplate), and the PVC/PV OBJECTS are gone while the DIRECTORIES survive. The 'PVC-based' flow assumes you have Velero backups of the PVCs and Secrets, which you do not. So you must bridge this yourself.

Directory naming decodes the original PVC names — local-path uses pvc-<uid>_<namespace>_<pvcname>:
  pvc-4b49a7d0-..._rook-ceph_rook-ceph-mon-r  -> PVC `rook-ceph-mon-r` in ns rook-ceph, on jahx
  pvc-f3f596cd-..._rook-ceph_rook-ceph-mon-k  -> PVC `rook-ceph-mon-k`, on xag
  pvc-c37bdbc4-..._rook-ceph_rook-ceph-mon-q  -> PVC `rook-ceph-mon-q`, on rvs
That confirms Rook's mon PVC naming is rook-ceph-mon-<id>, so you can pre-create PVCs with those exact names and Rook will use them rather than provisioning new ones.

OPTION A (RECOMMENDED — preserves your spec): pre-create a `local` PV per mon pointing at the surviving directory, plus a matching PVC. Use `local` + nodeAffinity, NOT hostPath: each mon store lives on a DIFFERENT node, and only nodeAffinity guarantees the mon pod lands on the node that actually holds its store. Set persistentVolumeReclaimPolicy: Retain on every PV — this is your seatbelt against any controller deleting the data. Pre-bind with claimRef to stop another PVC stealing the PV.

apiVersion: v1
kind: PersistentVolume
metadata:
  name: mon-r-restore
spec:
  capacity: { storage: 2Gi }
  accessModes: [ReadWriteOnce]
  persistentVolumeReclaimPolicy: Retain      # CRITICAL
  storageClassName: local-path
  claimRef: { namespace: rook-ceph, name: rook-ceph-mon-r }
  local:
    path: /var/lib/rancher/k3s/storage/pvc-4b49a7d0-549d-40d7-870a-59837dcb0467_rook-ceph_rook-ceph-mon-r
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - { key: kubernetes.io/hostname, operator: In, values: [amrc-fpd-jahx] }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: rook-ceph-mon-r, namespace: rook-ceph }
spec:
  accessModes: [ReadWriteOnce]
  storageClassName: local-path
  resources: { requests: { storage: 2Gi } }
  volumeName: mon-r-restore

Repeat for k (xag, pvc-f3f596cd-...) and q (rvs, pvc-c37bdbc4-...). Keep the `mapping` field in the ConfigMap consistent with the nodeAffinity — they must agree.

OPTION B (SIMPLER, deviates from original spec): drop mon.volumeClaimTemplate entirely and copy each surviving store to dataDirHostPath so Rook uses hostPath mons — `cp -a <pvcdir>/. /var/lib/rook/mon-r/` on jahx, etc. This matches the doc's assumed layout exactly and removes all PV/PVC/local-path complexity. Mon stores are small (your mon_data_size_warn was 1500Mi) so the copy is cheap, and copying is inherently non-destructive to the original. Since you are rebuilding at v5.1.0 afterwards anyway, the spec deviation costs you nothing. If Option A stalls on PV binding, switch to B rather than fighting it.

Either way, work on COPIES of the mon stores. Any ceph-monstore-tool or ceph-mon invocation can rewrite the store in place.

Sources: https://raw.githubusercontent.com/rook/rook/master/Documentation/Troubleshooting/disaster-recovery.md (lines 252-269 PVC flow, 271-341 namespace flow) ; https://rook.io/docs/rook/latest/CRDs/Cluster/ceph-cluster-crd/ ; local: /Users/me1ago/code/factoryplus-flux clusters/fpd-jahx/rook-ceph/cluster.yaml (origin/main)

## Backups: what to copy when you cannot image 100GB disks

You cannot image 3x ~100GB of /dev/sdb onto a jahx root fs with ~10GB free. Accept that and re-scope: the metadata is tiny, irreplaceable, and is what actually gates the restore. The disks are large, replaceable-in-principle (it is test data), and are protected procedurally because nothing zaps them unless you set wipeDevicesFromOtherClusters.

TIER 1 — MUST BACK UP, TINY, DO THIS FIRST (single-digit MB + mon stores):
  - /var/lib/rook/rook-ceph/client.admin.keyring  (152 bytes) — irreplaceable
  - /var/lib/rook/rook-ceph/rook-ceph.config      (319 bytes) — fsid AND the original mon IPs; the single most valuable file you have
  - /var/lib/rook/rook-ceph/<cluster-fsid>_<osd-fsid>/  — the OSD dirs. These hold each OSD's keyring, whoami, ceph_fsid and the `block` symlink. Losing these makes OSD activation much harder.
  - the three mon store dirs under /var/lib/rancher/k3s/storage/ — a few hundred MB at most; mon_data_size_warn was set to 1500Mi.
Copy these OFF the nodes (scp to your laptop / a NAS). They fit anywhere. Do this before touching anything else.

TIER 2 — /dev/sdb (~100GB each), if you can find the space:
  - Attach a USB disk or mount NFS/SMB, then stream-compress. A mostly-empty test BlueStore disk compresses hard, so 100GB may land at a few GB:
      sudo dd if=/dev/sdb bs=4M status=progress | zstd -T0 -3 > /mnt/backup/sdb-jahx.img.zst
  - Do NOT write the image to the local root fs — 10GB free will fill and could destabilise the node.
  - If no target exists, proceed WITHOUT the image but treat it as a formal risk acceptance: it is test data, the disks are only at risk from an explicit opt-in flag, and the fail-safe behaviour is 'skip', not 'wipe'.

READ-ONLY VERIFICATION OF THE DISK (safe, does not write):
  sudo ceph-bluestore-tool show-label --dev /dev/sdb
Run inside a matching-version ceph container. show-label is a read; `zap-device` is the destructive sibling — never type that one.

Sources: https://github.com/rook/rook/blob/master/pkg/daemon/ceph/osd/volume.go#L917-L955 ; https://raw.githubusercontent.com/rook/rook/master/Documentation/Troubleshooting/disaster-recovery.md (line 175) ; local: clusters/fpd-jahx/rook-ceph/cluster.yaml mon_data_size_warn

## Get the data out before you rebuild — rbd export is the actual goal

Worth stating plainly because it changes the risk calculus: you do not need a permanently healthy Rook cluster. You need the RBD images long enough to export them. Once mons are in quorum and OSDs are up and PGs are active, get the payload OUT to a filesystem you control, THEN rebuild fresh at v5.1.0 without any of this archaeology.

From the toolbox pod, non-destructive:
  ceph -s ; ceph osd tree ; ceph df
  rbd -p ceph-blockpool ls -l
  rbd -p ceph-blockpool export <image> /backup/<image>.img

Your pool is `ceph-blockpool` (from cluster.yaml cephBlockPools[0].name), StorageClass `ceph-block`, replicated size 2, imageFormat 2, imageFeatures layering, fstype ext4. Each PV maps to one RBD image; correlate via the image name and, if needed, `rbd info`. The ACS payloads you care about — Postgres (ConfigDB/auth/directory device definitions and test config), InfluxDB history, Grafana dashboards/users — are each a single RBD image containing an ext4 filesystem.

A cleaner extraction that skips Postgres/Influx consistency worries: rather than restoring PVs into the new ACS, map or loop-mount each exported image read-only, copy the files out, then load them into v5.1.0 through the application's own path (pg_dump/pg_restore for Postgres, influx backup/restore, Grafana DB copy). RBD images captured from an unclean shutdown are crash-consistent, not application-consistent — ext4 will replay its journal fine, but Postgres may need recovery on first start. Exporting the image first means you can retry that as many times as you like from an immutable copy.

If a full Rook restore proves too painful, there is a lower-level fallback that does not need Rook or k8s at all: ceph-objectstore-tool can rebuild a mon store directly from the OSDs (the documented 'recover monstore' procedure), after which you can run a minimal Ceph cluster by hand purely to export. Keep this in reserve; do not start here.

Sources: local: /Users/me1ago/code/factoryplus-flux clusters/fpd-jahx/rook-ceph/cluster.yaml (origin/main) ; https://docs.ceph.com/en/reef/rados/troubleshooting/troubleshooting-mon/ ; https://rook.io/docs/rook/latest/Storage-Configuration/Block-Storage-RBD/block-storage/

## Determining the RUNNING Ceph version — four independent read-only sources

This gates every other decision, so corroborate with at least two. All are reads.

1. CACHED CONTAINER IMAGES (fastest, most direct — but k3s was rebuilt, so images may have been pruned; still worth one command):
     sudo k3s crictl images | grep -iE 'ceph|rook'
   A cached quay.io/ceph/ceph:v19.2.3 alongside rook/ceph:v1.18.x is near-conclusive. Note: on a rebuilt k3s the containerd image store may or may not have survived — check /var/lib/rancher/k3s/agent/containerd.

2. CEPH DAEMON LOGS (most authoritative). Every daemon logs a version banner on start. Logs run to ~2026-06-01, so the LAST banner is the version at wipe time:
     sudo sh -c "grep -ohE 'ceph version [0-9]+\.[0-9]+\.[0-9]+' /var/lib/rook/rook-ceph/log/*.log | sort -u"
     sudo sh -c "zgrep -ohE 'ceph version [0-9]+\.[0-9]+\.[0-9]+' /var/lib/rook/rook-ceph/log/*.gz | sort -u"
   Then get the MOST RECENT rather than just unique values:
     sudo sh -c "ls -lt /var/lib/rook/rook-ceph/log/ | head"
     sudo sh -c "grep -hE 'ceph version' \$(ls -t /var/lib/rook/rook-ceph/log/*.log | head -1) | tail -5"
   Also check ceph-volume.log, which records the version at each OSD activation:
     sudo sh -c "grep -ohE 'ceph version [0-9]+\.[0-9]+\.[0-9]+' /var/lib/rook/rook-ceph/log/ceph-volume.log* | tail -5"

3. MON STORE min_mon_release (a clean integer, independent of logs). Ceph writes the min mon release into the mon data dir:
     sudo sh -c 'cat /var/lib/rancher/k3s/storage/pvc-4b49a7d0-*_rook-ceph_rook-ceph-mon-r/data/min_mon_release'
   18 = Reef, 19 = Squid, 20 = Tentacle. If the file is absent, list the dir to see what is there:
     sudo sh -c 'ls -la /var/lib/rancher/k3s/storage/pvc-4b49a7d0-*_rook-ceph_rook-ceph-mon-r/data/'

4. OSD DIR require_osd_release (same idea, from the OSD side):
     sudo sh -c 'ls -la /var/lib/rook/rook-ceph/0fbfc870-3ee0-4908-a7a6-be512830df66_06df283a-f919-4750-bbeb-43865bcf6f24/'
     sudo sh -c 'cat /var/lib/rook/rook-ceph/0fbfc870-*_06df283a-*/require_osd_release 2>/dev/null'

DO NOT rely on the bluestore label's ceph_version_when_created: 18.2.1 — that is stamped once at OSD creation (Jan 2024) and never updated. Your instinct on this was correct.

If sources conflict, trust the newest log banner. If you genuinely cannot determine it, start with Rook v1.15.9 + the exact 18.2.x you find on the label: v1.15 has Minimum 17.2.0 and supports Quincy+Reef+Squid, giving it the widest tolerance of any release in the matrix, so it is the safest blind guess.

Sources: https://github.com/rook/rook/blob/v1.15.9/pkg/operator/ceph/version/version.go#L43-L58 ; https://docs.ceph.com/en/reef/rados/configuration/mon-config-ref/ ; https://docs.ceph.com/en/reef/rados/troubleshooting/troubleshooting-mon/

## Commands

    # ===== PHASE 0: FORENSICS + BACKUP (read-only). Run on ALL THREE nodes. =====
    # 0.1 Confirm fsid and — crucially — capture the ORIGINAL mon service IPs.
    sudo cat /var/lib/rook/rook-ceph/rook-ceph.config
    # ^^ Record the 'mon initial members' and 'mon host' lines VERBATIM. Zip them positionally: Nth id <-> Nth IP.
    sudo cat /var/lib/rook/rook-ceph/client.admin.keyring
    
    # 0.2 Verify the new k3s service CIDR still contains those mon IPs (k3s default 10.43.0.0/16).
    sudo grep -rE 'service-cidr|cluster-cidr' /etc/rancher/k3s/ 2>/dev/null; kubectl cluster-info dump | grep -m1 service-cluster-ip-range
    # If the old mon IPs fall outside the new range, or are already taken, STOP - you need monmap surgery instead.
    
    # 0.3 Inventory the OSD dir (holds the OSD keyring + block symlink).
    sudo sh -c 'ls -la /var/lib/rook/rook-ceph/0fbfc870-3ee0-4908-a7a6-be512830df66_*/'
    
    # 0.4 TIER-1 BACKUP - tiny, irreplaceable, DO THIS BEFORE ANYTHING ELSE.
    sudo tar czf /tmp/rook-meta-$(hostname).tgz -C /var/lib/rook rook-ceph
    sudo sh -c 'tar czf /tmp/mon-store-$(hostname).tgz -C /var/lib/rancher/k3s/storage $(cd /var/lib/rancher/k3s/storage && ls -d pvc-*_rook-ceph_rook-ceph-mon-*)'
    # Copy BOTH tarballs off the node now (scp to laptop/NAS). Verify they landed before proceeding.
    
    # ===== PHASE 1: DETERMINE THE RUNNING CEPH VERSION (gates everything) =====
    sudo k3s crictl images | grep -iE 'ceph|rook'
    sudo sh -c "grep -ohE 'ceph version [0-9]+\.[0-9]+\.[0-9]+' /var/lib/rook/rook-ceph/log/*.log | sort -u"
    sudo sh -c "zgrep -ohE 'ceph version [0-9]+\.[0-9]+\.[0-9]+' /var/lib/rook/rook-ceph/log/*.gz 2>/dev/null | sort -u"
    sudo sh -c "grep -hE 'ceph version' \$(ls -t /var/lib/rook/rook-ceph/log/*.log | head -1) | tail -5"
    sudo sh -c "grep -ohE 'ceph version [0-9]+\.[0-9]+\.[0-9]+' /var/lib/rook/rook-ceph/log/ceph-volume.log* 2>/dev/null | tail -5"
    sudo sh -c 'cat /var/lib/rancher/k3s/storage/pvc-*_rook-ceph_rook-ceph-mon-*/data/min_mon_release 2>/dev/null'   # 18=Reef 19=Squid 20=Tentacle
    sudo sh -c 'cat /var/lib/rook/rook-ceph/0fbfc870-*_*/require_osd_release 2>/dev/null'
    # Corroborate with >=2 sources. Do NOT trust the disk label's 18.2.1 (creation-time only).
    
    # ===== PHASE 2: EXTRACT THE KEYS =====
    # 2.1 client.admin key -> ceph-secret (bare key only, no [client.admin] header).
    sudo awk '/key =/{print $3}' /var/lib/rook/rook-ceph/client.admin.keyring
    sudo sh -c "awk '/key =/{print \$3}' /var/lib/rook/rook-ceph/client.admin.keyring | tr -d '\n' | base64 -w0"
    
    # 2.2 mon. key -> mon-secret. Look in the mon data dir (this is the real key; the doc's admin-key shortcut is a simplification).
    sudo sh -c 'ls -la /var/lib/rancher/k3s/storage/pvc-4b49a7d0-*_rook-ceph_rook-ceph-mon-r/data/'
    sudo sh -c 'cat /var/lib/rancher/k3s/storage/pvc-4b49a7d0-*_rook-ceph_rook-ceph-mon-r/data/keyring'
    sudo sh -c "awk '/key =/{print \$3}' /var/lib/rancher/k3s/storage/pvc-4b49a7d0-*_rook-ceph_rook-ceph-mon-r/data/keyring | tr -d '\n' | base64 -w0"
    # Cross-check the same key appears on xag (mon k) and rvs (mon q).
    
    # 2.3 FALLBACK if data/keyring is missing - dump the auth db offline from a COPY of the store.
    sudo mkdir -p /tmp/monwork && sudo sh -c 'cp -a /var/lib/rancher/k3s/storage/pvc-4b49a7d0-*_rook-ceph_rook-ceph-mon-r /tmp/monwork/mon-r'
    sudo docker run --rm -v /tmp/monwork:/monwork quay.io/ceph/ceph:<PINNED_TAG> ceph-monstore-tool /monwork/mon-r/data dump-keys | grep -A3 '^mon\.'
    # NOTE: operate ONLY on /tmp/monwork copies. Never point ceph-monstore-tool at the original store.
    
    # 2.4 fsid (already known/precomputed).
    printf '%s' '0fbfc870-3ee0-4908-a7a6-be512830df66' | base64   # -> MGZiZmM4NzAtM2VlMC00OTA4LWE3YTYtYmU1MTI4MzBkZjY2
    printf '%s' 'client.admin' | base64                          # -> Y2xpZW50LmFkbWlu
    
    # ===== PHASE 3: PRE-SEED IDENTITY *BEFORE* ANY CephCluster CR EXISTS =====
    # Order matters. Namespace + Secret + ConfigMap FIRST. No CephCluster CR yet - a CR with no Secret mints a NEW random fsid.
    kubectl create namespace rook-ceph
    kubectl apply -f rook-ceph-mon-secret.yaml -f rook-ceph-mon-endpoints.yaml
    kubectl -n rook-ceph get secret rook-ceph-mon -o jsonpath='{.data.fsid}' | base64 -d; echo
    # ^^ MUST print 0fbfc870-3ee0-4908-a7a6-be512830df66 before you go further. If not, STOP.
    
    # ===== PHASE 4: MON PVs/PVCs (Retain + nodeAffinity) =====
    kubectl apply -f mon-pvs.yaml
    kubectl get pv -o wide; kubectl -n rook-ceph get pvc
    # All three PVCs must show Bound to the right node's PV before proceeding.
    
    # ===== PHASE 5: OPERATOR ONLY, PINNED, NO OSDs YET =====
    # Suspend Flux so it cannot race you with an unpinned 'latest'.
    flux suspend helmrelease -n rook-ceph rook-ceph
    flux suspend helmrelease -n rook-ceph ceph-cluster
    # Deploy operator pinned. Then CephCluster with storage.nodes: [] so NO osd-prepare job runs during bootstrap.
    kubectl -n rook-ceph logs -f deploy/rook-ceph-operator
    kubectl -n rook-ceph get svc | grep mon    # ClusterIPs MUST match the old 'mon host' IPs
    
    # ===== PHASE 6: VERIFY QUORUM AND FSID BEFORE ADDING DISKS =====
    kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph -s
    kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph fsid    # MUST be 0fbfc870-3ee0-4908-a7a6-be512830df66
    kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph mon dump
    kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph osd tree   # expect old OSDs listed, down/out
    # GATE: only if fsid is correct and mons are in quorum do you add the disks back.
    
    # ===== PHASE 7: ADD DISKS BACK (the adoption moment) =====
    # Re-add storage.nodes (jahx/xag/rvs sdb). useAllDevices MUST stay false. NO cleanupPolicy block AT ALL.
    kubectl -n rook-ceph logs -l app=rook-ceph-osd-prepare --tail=200 | grep -iE 'already prepared|skipping|different ceph cluster|zap'
    # WANT: 'Raw device /dev/sdb is already prepared'  ->  adopting.
    # STOP:  'skipping osd.N: belonging to a different ceph cluster'  ->  fsid wrong. Fix the Secret. Do NOT set wipeDevicesFromOtherClusters.
    # ABORT: any line containing 'zap'  ->  scale operator to 0 immediately.
    kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph -s
    kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph osd tree
    
    # ===== PHASE 8: GET THE PAYLOAD OUT =====
    kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- ceph df
    kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- rbd -p ceph-blockpool ls -l
    kubectl -n rook-ceph exec -it deploy/rook-ceph-tools -- rbd -p ceph-blockpool export <image> /backup/<image>.img
    # Export every image to durable storage BEFORE any rebuild. Then loop-mount read-only and copy files out,
    # and reload into v5.1.0 via pg_restore / influx restore / Grafana DB copy rather than re-attaching raw PVs.
    
    # ===== EMERGENCY STOP (memorise this) =====
    kubectl -n rook-ceph scale deploy/rook-ceph-operator --replicas=0

## Risks

- CATASTROPHIC: setting spec.cleanupPolicy.wipeDevicesFromOtherClusters: true. It is the ONLY switch that destroys /dev/sdb, it is absent from the CephCluster CRD web docs (Go types only), and its description ('useful in scenarios where ceph cluster was reinstalled but OSD disk still contains the metadata from previous ceph cluster') reads like an exact description of your situation. It is a trap. It runs ceph-volume lvm zap then ceph-bluestore-tool zap-device --yes-i-really-really-mean-it. Never set it.
- CATASTROPHIC: following the doc's 'Adopt an existing Rook Ceph cluster into a new Kubernetes cluster' flow. Its step 4 is literally 'Remove /var/lib/rook from all the Rook Ceph nodes' - deleting client.admin.keyring, rook-ceph.config and the OSD keyring dirs. Its reassurance that Rook won't touch mismatched-fsid disks predates the wipe feature (example image ceph:v14.2.1-20190430, 2019).
- CATASTROPHIC: letting Flux reconcile at any point before the rook-ceph-mon Secret exists. Your HelmReleases pin NOTHING and reconcile every 5m. A CephCluster CR with no Secret makes the operator mint a NEW random fsid (cluster_info.go:213), instantly making every OSD 'from a different cluster'. Run `flux suspend helmrelease` on BOTH rook-ceph and ceph-cluster before you start, and do not unsuspend until the data is exported.
- HIGH: deploying today's 'latest' Rook (v1.19.x, Minimum = Ceph 19.2.0) against Reef 18.x data. Hard-fails with 'the version does not meet the minimum version'; allowUnsupported CANNOT override Minimum. Fails safe (refuses, does not wipe) but blocks you until you pin correctly.
- HIGH: assuming Ceph 18.2.1 because that is what the disk label says. It is creation-time only (Jan 2024). Chart-default drift means the cluster was very likely on Squid 19.2.x by June 2026. Pinning 18.2.x against Squid data risks Rook attempting a DOWNGRADE - which it explicitly warns is unsupported ('downgrading is not supported', cluster/version.go).
- HIGH: the whole no-monmap-surgery shortcut depends on the new k3s cluster reusing the ORIGINAL mon ClusterIPs. If the service CIDR changed, or those IPs are already allocated to other Services, Rook's mon Services get different IPs, the monmap in the surviving stores is then wrong, and mons will never form quorum. Verify the CIDR in Phase 0 before committing to this route.
- MEDIUM: mon pod scheduled onto the wrong node. Each mon store is node-local (r=jahx, k=xag, q=rvs). If the ConfigMap `mapping` and the PV nodeAffinity disagree, a mon starts against an empty directory and may initialise a fresh store. Keep them consistent and use `local` PVs with nodeAffinity, never hostPath.
- MEDIUM: running ceph-monstore-tool or ceph-mon against the ORIGINAL mon store. Both can rewrite in place. Always copy to /tmp/monwork first. Same for any container mounting the store rw.
- MEDIUM: PV reclaim policy. Any PV created without persistentVolumeReclaimPolicy: Retain can have its backing directory deleted by the local-path provisioner when the PVC goes away. Set Retain on all three and pre-bind with claimRef.
- MEDIUM: reaching for continueUpgradeAfterChecksEvenIfNotHealthy because the cluster starts unhealthy. Degraded PGs during OSD boot are EXPECTED and are not an upgrade condition. Wanting this flag means your cephVersion.image pin is wrong; fix the pin. Setting it can let Rook restart OSDs across a version boundary on unhealthy PGs.
- MEDIUM: crash-consistency. RBD images captured from an unclean shutdown are crash-consistent, not application-consistent. ext4 will replay its journal, but Postgres may need recovery on first start. Export images to immutable files FIRST so recovery can be retried without risking the originals.
- LOW/PROCEDURAL: no full disk images means no undo. Given ~10GB free on jahx and ~100GB per disk, Tier-1 metadata backup plus procedural discipline is the realistic control. If a USB disk or NFS target can be found, stream-compress each sdb (a mostly-empty test BlueStore disk compresses hard) and the risk largely disappears.
- LOW: `admin-secret` in the rook-ceph-mon Secret. It is a deprecated key; if set to the literal string 'admin-secret' the operator diverts to looking for a separate rook-ceph-operator-creds Secret and bootstrap fails confusingly. Omit the key entirely.

## Open questions

- What Ceph version was ACTUALLY running on 2026-06-01? This gates the Rook chart pin and every subsequent step. Phase 1 gives four independent read-only sources (crictl image cache, log banners incl. rotated .gz, mon store min_mon_release, OSD require_osd_release). Corroborate at least two. My reconstruction from chart-default drift says Squid 19.2.x is most likely, but this MUST be measured, not assumed.
- Does /var/lib/rancher/k3s/storage/pvc-*_rook-ceph_rook-ceph-mon-r/data/keyring exist? That file is the real mon. key and the cleanest answer to your mon-secret question. If absent, fall back to ceph-monstore-tool dump-keys on a COPY, then to the doc's admin-key shortcut, then to the disable-auth escape hatch. I could not confirm the file's presence without cluster access.
- What are the ORIGINAL mon ClusterIPs in the 'mon host' line of rook-ceph.config, and does the rebuilt k3s cluster's service CIDR still contain them? This single question decides between an easy restore (reuse IPs, monmap stays valid) and a hard one (monmap surgery with monmaptool). Check it in Phase 0 before anything else.
- Did the containerd image cache survive the k3s rebuild? `sudo k3s crictl images | grep -iE 'ceph|rook'` would settle the version question in one command, but the rebuild may have pruned /var/lib/rancher/k3s/agent/containerd.
- Is there ANY external storage (USB disk, NFS/SMB share) reachable from the nodes? If yes, image the three sdb devices with dd|zstd and the entire risk profile of this operation collapses. Worth 30 minutes of hunting before starting.
- Option A (recreate local-path PVs/PVCs, preserves your spec) vs Option B (drop volumeClaimTemplate, copy mon stores to /var/lib/rook/mon-<id>, matches the doc exactly)? I lean A for fidelity, but B is materially simpler and you are rebuilding at v5.1.0 afterwards anyway so the spec deviation is free. Recommend trying A and switching to B rather than fighting PV binding.
- Was mon-r on jahx actually in quorum at the moment of the wipe? All three stores survive so this is probably moot, but if one store is stale you want to restore from the freshest. Compare mtimes across the three store.db dirs before choosing.
- Do you actually want a restored Rook cluster, or just the RBD images? If the latter (which your stated goal implies), the bar is much lower: quorum + OSDs up + rbd export, then throw it all away. That framing permits shortcuts like mon.count=1 that would be unacceptable for a production restore.
- Independent of this recovery: the unpinned HelmReleases in clusters/fpd-jahx/rook-ceph/ are how a test cluster silently drifted across two Ceph majors. Worth pinning chart version AND cephVersion.image in the GitOps repo permanently, plus verifying the ceph.rook.io/disaster-protection finalizers survive on the rebuilt cluster - they are exactly what would have made this incident a non-event.