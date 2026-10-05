# OpenMetadata deployment

[OpenMetadata](https://open-metadata.org/) has been deployed into ACS as a set
of Helm chart dependencies from
[open-metadata/openmetadata-helm-charts](https://github.com/open-metadata/openmetadata-helm-charts),
declared in `/deploy/Chart.yaml` and configured in `/deploy/values.yaml`.
This directory (`acs-openmetadata`) holds the ingestion image patch: a
patched ingestion image, built with the `Dockerfile`/`Makefile` here, that
works around two problems in the upstream image (see
[Troubleshooting](#troubleshooting) below). The OpenSearch image gets a
similar log4j patch, but lives in its own `acs-opensearch` directory since
it isn't part of the ingestion image - see
[acs-opensearch/README.md](../acs-opensearch/README.md). The OpenMetadata
**server** image needs no such patch - see the note at the end of
[Troubleshooting](#troubleshooting).

## Components

OpenMetadata is not a single deployment - the upstream charts bring in several
moving parts. What's actually running in the cluster:

| Component                                           | Chart / image                                        | Function                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenMetadata server**                             | `openmetadata` chart                                 | The metadata catalogue itself - the web UI and API that stores and serves schema/lineage/ownership metadata for data assets. Runs the stock upstream `docker.getcollate.io/openmetadata/server` image unpatched - its bundled log4j is already at a fixed version, see [Troubleshooting](#troubleshooting). |
| **MySQL**                                           | `openmetadata-dependencies` → `mysql` (Bitnami)      | OpenMetadata's own relational store, holding both the `openmetadata_db` (catalogue metadata) and `airflow_db` (ingestion pipeline scheduling state) databases.                                                                                                                                                                                                                                                                                             |
| **OpenSearch**                                      | `openmetadata-dependencies` → `opensearch`           | Search/index backend behind OpenMetadata's search UI and discovery features. The upstream chart calls this dependency "elasticsearch" throughout (config keys, secret names) for historical reasons, but the image actually deployed is OpenSearch - a drop-in, license-compatible fork. Don't be misled by the naming when reading `values.yaml`. Runs a log4j-patched image built from `acs-opensearch` (see [its README](../acs-opensearch/README.md)). |
| **Airflow**                                         | `openmetadata-dependencies` → `airflow`              | Runs OpenMetadata's ingestion pipelines (metadata/profiler/lineage extraction jobs) on a schedule. OpenMetadata talks to it over its "pipeline service client" API rather than the user interacting with Airflow directly.                                                                                                                                                                                                                                 |
| **Ingestion image** (`acs-openmetadata/Dockerfile`) | `{{registry}}/openmetadata-ingestion:2.0.3-patched` | The image Airflow's workers actually run. Built here from upstream's `openmetadata/ingestion` image with the PySpark log4j fix baked in - see [Troubleshooting](#troubleshooting).                                                                                                                                                                                                                                                                                     |

An already-deployed ACS PostgreSQL database was **not** reused for
OpenMetadata's own storage. ACS's shared Postgres is only reachable via
Kerberos authentication, and the upstream OpenMetadata/Airflow charts only
know how to authenticate to a database with a username and password - there's
no way to plug Kerberos into them. Rather than fork the charts to add
Kerberos support, a separate MySQL instance is deployed via
`openmetadata-dependencies` for OpenMetadata's exclusive use, authenticated
with a generated username/password instead.

## Installation

The OpenMetadata Helm repo was added:

```sh
helm repo add open-metadata https://helm.open-metadata.org/
```

The two charts were then added as dependencies in `/deploy/Chart.yaml`:

```yaml
- name: openmetadata
  version: 2.0.3
  repository: https://helm.open-metadata.org/
  condition: openmetadata.enabled
- name: openmetadata-dependencies
  version: 2.0.3
  repository: https://helm.open-metadata.org/
  condition: openmetadata-dependencies.enabled
```

Running `helm dependency update` from `/deploy` pulls both charts down as
`.tgz` archives into `/deploy/charts`, where they're picked up automatically
by the parent ACS chart. Both are gated by `enabled` flags in `values.yaml`
so OpenMetadata can be switched off entirely for deployments that don't want
it.

## Secrets

The upstream charts expect a handful of passwords (MySQL root/user, the
separate Airflow MySQL user, Airflow's web UI admin user, OpenSearch's admin
user) to already exist as Kubernetes Secrets rather than generating them
internally. `/deploy/templates/openmetadata/openmetadata-secrets.yaml`
generates all of these with `randAlphaNum`/`randAlpha`/`randNumeric` the
first time the chart is installed, and is written so that re-running
`helm upgrade` never regenerates or overwrites them:

- Every secret is guarded with
  `{{- if not (lookup "v1" "Secret" .Release.Namespace "<name>") }}` - if the
  secret already exists in the cluster, the block is skipped and the
  existing value (and therefore the existing password) survives the upgrade.
- Each generated secret carries `helm.sh/resource-policy: keep`, so `helm
uninstall` doesn't delete it either. Passwords only disappear if the
  namespace itself is deleted.
- The Airflow MySQL password is a special case: it has to end up in _two_
  places that must agree - the password the MySQL `initdbScripts` actually
  sets for `airflow_user`, and the SQLAlchemy connection string in
  `airflow-metadata-db` that the Airflow chart uses to reach that same user.
  There's no per-field secret reference for just the password on the Airflow
  side, only a full pre-built connection string, so the template reads the
  password back out of the first secret (if it already exists) and reuses it
  when building the second, rather than generating it twice and having the
  two drift apart.
- The OpenSearch/`elasticsearch-secrets` password is built from
  `randAlpha`/`randNumeric` plus a fixed trailing symbol, because OpenSearch's
  admin password policy requires upper+lower+digit+symbol and Sprig has no
  single "random alphanumeric-with-symbols" helper.

`values.yaml` then wires these secrets into the charts via each chart's own
`secretRef`/`existingSecret` contract (`openmetadata.openmetadata.config.*.password.secretRef`,
`openmetadata-dependencies.mysql.auth.existingSecret`, Airflow's
`metadataSecretName`, `createUserJob.defaultUser.password`, etc.).

## Troubleshooting

These are the encountered problems that were worked around by configuring `values.yaml` and `Dockerfile`s.

### Fix: runtime pip installation (no longer needed)

The `openmetadata-dependencies` 1.x Airflow chart installed
`apache-airflow-providers-fab==2.4.4` at **container start** via the
`_PIP_ADDITIONAL_REQUIREMENTS` env var (a workaround for an Airflow 3 + MySQL
`CREATE INDEX IF NOT EXISTS` incompatibility). That was slow and fragile, so
`acs-openmetadata/Dockerfile` used to pre-install the same pin at build time
instead.

From OpenMetadata 2.x the upstream chart no longer does this, and the
`openmetadata/ingestion` image already ships a newer FAB provider (3.9.0 in
`2.0.3`). Keeping the `==2.4.4` pin made pip **downgrade** the image's
Airflow from 3.3.2 to 3.1.8 to satisfy it, so the pin has been removed and
the image now runs the Airflow/FAB versions OpenMetadata ships with.

`deploy/values.yaml` still sets the env var to empty, so that no runtime pip
install happens even if a future upstream chart re-adds one:

```yaml
openmetadata-dependencies:
  airflow:
    env:
      - name: _PIP_ADDITIONAL_REQUIREMENTS
        value: "" # Empty string disables the fragile runtime pip installation step
```

If the Airflow scheduler or `airflow db migrate` fails against MySQL with a
`CREATE INDEX IF NOT EXISTS` error after this change, the original
incompatibility has come back - re-add a FAB pin compatible with the
image's Airflow version rather than `2.4.4`.

### Fix: `log4j-core` vulnerability

The upstream ingestion image bundles PySpark, which in turn bundles its own
older copy of `log4j-core`/`log4j-api` under its `jars/` directory - affected
by known log4j2 CVEs. The Dockerfile removes those jars and drops in a
patched 2.x release instead:

```dockerfile
ARG LOG4J_VERSION=2.26.1
RUN PYSPARK_JARS="$(python -c 'import os, pyspark; print(os.path.join(os.path.dirname(pyspark.__file__), "jars"))')" \
    && rm -f "${PYSPARK_JARS}"/log4j-core-*.jar "${PYSPARK_JARS}"/log4j-api-*.jar \
    && python -c "...urlretrieve(.../log4j-core-${LOG4J_VERSION}.jar...)" \
    && python -c "...urlretrieve(.../log4j-api-${LOG4J_VERSION}.jar...)"
```

log4j2's public API is stable across patch versions, so this is a safe
drop-in swap that doesn't require touching PySpark itself or knowing whether
the Spark profiling engine is actually exercised.

This is a PySpark-specific problem, not an OpenMetadata one - the
OpenMetadata **server** image (`docker.getcollate.io/openmetadata/server`,
a different upstream image from `openmetadata/ingestion`) bundles its own
copy of log4j under `/opt/openmetadata/libs`, and as of upstream `2.0.0` through
`2.0.3` that copy is already log4j-core/log4j-api `2.25.5` - past the
`2.25.4` fix version for the outstanding log4j2 CVEs (CVE-2025-68161,
CVE-2026-34477 through CVE-2026-34480). There used to be an
`acs-openmetadata-server` image that patched those jars too, but it was
removed once this was confirmed - `values.yaml` now points the `openmetadata`
chart at the stock server image with no patch needed. If a future upstream
release regresses to an older log4j, re-add that patch rather than assuming
it's still fixed.

### Building and pushing the patched image

Requires the [`crane`](https://github.com/google/go-containerregistry) CLI on
`PATH` in addition to `docker buildx` - see below.

```sh
cd acs-openmetadata
make build
```

`make build` (via `mk/acs.docker.mk`) runs
`docker buildx build --push --platform linux/amd64 -t <registry>/openmetadata-ingestion:2.0.3-patched .`,
then flattens the pushed image with `crane flatten`. `rm`-ing a file in a
Dockerfile only hides it behind a whiteout - the bytes are still present in
the upstream base image's layer underneath, which file-level vulnerability
scanners that walk a node's disk (rather than asking a registry to resolve
the image) will still flag. Flattening merges the layers into one via the
registry API so the removed jar is actually gone, not just masked; `crane`
preserves the image's config (`ENV`/`ENTRYPOINT`/`CMD`/`USER`/etc.)
unchanged - only the filesystem layers are affected. This is opted into via
`flatten=1` in this directory's `Makefile` and is a no-op for every other
ACS service's `make build`, since `mk/acs.docker.mk` only runs it when
`flatten` is set.

The `version` in the `Makefile` is pinned to `2.0.3` on purpose (not the
usual `?=` override) - it tracks the upstream `openmetadata/ingestion`
version this Dockerfile patches, not ACS's own release version, so it must
not follow `config.mk`'s `version=` override for ACS's own services. The
resulting tag is what `deploy/values.yaml` references:

```yaml
openmetadata-dependencies:
  airflow:
    images:
      airflow:
        repository: ghcr.io/amrc-factoryplus/openmetadata-ingestion
        tag: 2.0.3-patched
```

### Fix: init DB scripts

The `openmetadata-dependencies` chart's own default `values.yaml` ships two
init scripts under `mysql.initdbScripts`
(`init_openmetadata_db_scripts.sql`, `init_airflow_db_scripts.sql`) with
hard-coded passwords baked in. Helm deep-merges map values rather than
replacing them, so simply adding our own `initdbScripts` entry on top left
the upstream scripts in place too, and MySQL ran _all_ of them on first
boot - creating users with passwords that didn't match the ones in our
generated secrets. `values.yaml` explicitly `null`s out both upstream keys
(Helm's "delete this key on merge" syntax) and replaces the Airflow one with
a `.sh` script (not `.sql`), so the container's own env vars
(`MYSQL_ROOT_PASSWORD`, set by the chart from `auth.existingSecret`, and
`AIRFLOW_MYSQL_PASSWORD`, injected via `primary.extraEnvVars`) can be
expanded into the script at runtime instead of a password being hard-coded
in the template:

```yaml
mysql:
  initdbScripts:
    init_openmetadata_db_scripts.sql: null
    init_airflow_db_scripts.sql: null
    init_airflow_db_scripts.sh: |
      #!/bin/bash
      set -e
      mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<-EOSQL
        CREATE DATABASE IF NOT EXISTS airflow_db ...
        CREATE USER IF NOT EXISTS 'airflow_user'@'%' IDENTIFIED BY '${AIRFLOW_MYSQL_PASSWORD}';
        GRANT ALL PRIVILEGES ON airflow_db.* TO 'airflow_user'@'%';
      EOSQL
```

The `openmetadata_db` database/user don't need a custom script at all -
`mysql.auth.database`/`mysql.auth.username` (pointed at the same
`openmetadata-mysql-secrets` used everywhere else) make the Bitnami chart
create them itself.

### Fix: MySQL killed by its startup probe on first boot

The Bitnami MySQL chart's default startup probe (15s initial delay, then
10 checks 10s apart) gives `mysqld` about two minutes to start. On network
block storage every fsync goes over the network, and on the Longhorn dev
cluster `mysqld --initialize` alone took ~100s. The probe then killed the
container in the middle of `mysql_upgrade`, with events like:

```
Startup probe failed: ... Access denied for user 'root'@'localhost'
Startup probe failed: ... Can't connect to local MySQL server through socket
  '/opt/bitnami/mysql/tmp/mysql.sock' (2)
Container mysql failed startup probe, will be restarted
```

(The `Access denied` is the probe running while the setup script is still
setting the root password - it is not a real credentials problem.)

After that the restarted container finds the half-built datadir
(`Using persisted data`), goes back into `mysql_upgrade`, and gets killed
again, so it never comes up. The first boot was also killed before the
custom `initdbScripts` ran, so `airflow_db`/`airflow_user` don't exist.
`values.yaml` raises the probe to about ten minutes:

```yaml
openmetadata-dependencies:
  mysql:
    primary:
      startupProbe:
        initialDelaySeconds: 30
        failureThreshold: 60
```

If a deployment has already got stuck like this on a fresh install, the
datadir is not worth keeping. Start again with an empty volume (this
**deletes all OpenMetadata and Airflow data**, so only do it on a fresh
install):

```sh
kubectl -n factory-plus scale statefulset mysql --replicas=0
kubectl -n factory-plus delete pvc data-mysql-0
helm upgrade --install acs ...   # recreates the PVC and scales back up
```

Leave `openmetadata-mysql-secrets` and `airflow-mysql-secrets` in place;
the new datadir will be initialised with them. A successful first boot
logs `Loading user's custom files from /docker-entrypoint-initdb.d` and
then `** MySQL setup finished! **`.

### Fix: `PASSWORDS ERROR` enabling OpenMetadata on an existing ACS release

Turning `openmetadata.enabled`/`openmetadata-dependencies.enabled` on via
`helm upgrade` against an ACS release that's already installed (rather than
a fresh `helm install`) fails with:

```
Error: UPGRADE FAILED: execution error at (amrc-connectivity-stack/charts/openmetadata-dependencies/charts/mysql/templates/secrets.yaml:9:17):
PASSWORDS ERROR: You must provide your current passwords when upgrading the release.
```

This isn't a real "you changed the password" problem - it's a chicken-and-egg
gap in the secret handling described in [Secrets](#secrets) above. Helm
renders every template in the release, top-level chart and subcharts alike,
in a single pass against the cluster state as it is *before* anything in
this release gets applied. `openmetadata-secrets.yaml`'s
`{{- if not (lookup ...) }}` guard and the Bitnami `mysql` subchart's own
`secrets.yaml` (which `auth.existingSecret: openmetadata-mysql-secrets`
points at) both run their `lookup` in that same pass, so on the very first
upgrade that turns OpenMetadata on, neither one can see a secret the other
is about to create. The `mysql` subchart then falls back to its own
password-validation logic, sees `.Release.IsUpgrade == true` (true for the
ACS release as a whole, even though OpenMetadata itself is being installed
for the first time), and refuses to invent a random password. A plain
`helm install` never hits this, because `IsUpgrade` is false there and the
check is skipped entirely.

The fix is to pre-create the secret by hand, once, with the same keys the
template would have generated, before running the upgrade:

```sh
kubectl create secret generic openmetadata-mysql-secrets \
  --namespace factory-plus \
  --from-literal=mysql-root-password="$(openssl rand -base64 24)" \
  --from-literal=mysql-password="$(openssl rand -base64 24)" \
  --from-literal=mysql-replication-password="$(openssl rand -base64 24)"

kubectl annotate secret openmetadata-mysql-secrets -n factory-plus helm.sh/resource-policy=keep
```

Re-run the same `helm upgrade --install` afterwards. Both `lookup` calls now
find the secret already present, so `openmetadata-secrets.yaml` skips
creating it and the `mysql` chart reads `mysql-password`/`mysql-root-password`
straight from it. The `helm.sh/resource-policy: keep` annotation matches
every other secret this chart manages, so it survives future upgrades the
same way.

### Fix: `ReadWriteMany` not available

Airflow's chart defaults to `CeleryExecutor`, which needs its DAGs and logs
directories mounted `ReadWriteMany` so the scheduler, webserver, triggerer
and every worker pod can all read/write them concurrently. The storage
classes available to ACS deployments don't support `ReadWriteMany`. Since
OpenMetadata only needs Airflow to run its own scheduled ingestion DAGs
(not arbitrary user workloads at scale), `values.yaml` switches to
`LocalExecutor` and scales workers to zero instead of trying to make RWX
work:

```yaml
openmetadata-dependencies:
  airflow:
    executor: "LocalExecutor"
    workers:
      replicas: 0
    airflow:
      config:
        AIRFLOW__CORE__EXECUTOR: "LocalExecutor"
```

`LocalExecutor` removes the worker pods, but the api-server, scheduler and
triggerer still all mount the DAGs/logs volumes. On a single-node cluster
that goes unnoticed, because `ReadWriteOnce` means one *node*, not one pod.
On a multi-node cluster the pods get scheduled onto different nodes and all
but the first fail with a `Multi-Attach` error. `values.yaml` therefore
gives those three pods a required `podAffinity` on each other so they
always share a node:

```yaml
openmetadata-dependencies:
  airflow:
    scheduler:
      affinity: &airflow-colocate
        podAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            - labelSelector:
                matchExpressions:
                  - { key: tier, operator: In, values: [airflow] }
                  - { key: component, operator: In,
                      values: [api-server, scheduler, triggerer] }
              topologyKey: kubernetes.io/hostname
    triggerer:
      affinity: *airflow-colocate
    apiServer:
      affinity: *airflow-colocate
```

If the pods are already spread across nodes when this is first applied,
the affinity is satisfied by any one of the others, so they can stay split.
Scale all three to zero and back up once to bring them together.

### `openmetadata-logs.pvc.yaml`

Because the executor change above means DAGs/logs only need `ReadWriteOnce`,
`deploy/templates/openmetadata/openmetadata-logs.pvc.yaml` defines plain
PVCs directly rather than relying on the Airflow chart's own
persistence-template defaults, and `values.yaml` points the chart at them
via `existingClaim`:

```yaml
logs:
  persistence:
    enabled: true
    existingClaim: "manual-airflow-logs"
dags:
  persistence:
    enabled: true
    existingClaim: "manual-airflow-dags"
```

The storage class, access mode and sizes of these PVCs come from
`openmetadataStorage` in `values.yaml`. The defaults (cluster default class,
`ReadWriteOnce`) match what the template has always rendered. On a cluster
with an RWX class (CephFS, NFS) you can set `accessMode: ReadWriteMany` and
drop the `podAffinity` above. Both fields are immutable on an existing PVC,
so switching means deleting and recreating the PVCs.

The `openmetadata-dependencies` chart's own values also mount
`<airflow fullname>-dags` (`acs-dags`) into the api-server via
`apiServer.extraVolumes` (for OpenMetadata's dynamic DAG generation),
independently of `dags.persistence.existingClaim`. Left alone, the
api-server writes generated DAGs to that volume while the scheduler reads
`manual-airflow-dags`, so pipelines deployed from the OpenMetadata UI never
reach the scheduler. `values.yaml` overrides `apiServer.extraVolumes` to
mount `manual-airflow-dags` instead, so no `acs-dags` PVC is created. If
that override is ever removed, the api-server will not start until an
`acs-dags` PVC exists again.

After upgrading to this override, redeploy each ingestion pipeline from the
OpenMetadata UI once, so its DAG is written to the volume the scheduler
actually reads.
