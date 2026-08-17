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
[acs-opensearch/README.md](../acs-opensearch/README.md).

## Components

OpenMetadata is not a single deployment - the upstream charts bring in several
moving parts. What's actually running in the cluster:

| Component                                           | Chart / image                                        | Function                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OpenMetadata server**                             | `openmetadata` chart                                 | The metadata catalogue itself - the web UI and API that stores and serves schema/lineage/ownership metadata for data assets. Runs a log4j-patched image built from `acs-openmetadata-server` (see [its README](../acs-openmetadata-server/README.md)). |
| **MySQL**                                           | `openmetadata-dependencies` → `mysql` (Bitnami)      | OpenMetadata's own relational store, holding both the `openmetadata_db` (catalogue metadata) and `airflow_db` (ingestion pipeline scheduling state) databases.                                                                                                                                                                                                                                                                                             |
| **OpenSearch**                                      | `openmetadata-dependencies` → `opensearch`           | Search/index backend behind OpenMetadata's search UI and discovery features. The upstream chart calls this dependency "elasticsearch" throughout (config keys, secret names) for historical reasons, but the image actually deployed is OpenSearch - a drop-in, license-compatible fork. Don't be misled by the naming when reading `values.yaml`. Runs a log4j-patched image built from `acs-opensearch` (see [its README](../acs-opensearch/README.md)). |
| **Airflow**                                         | `openmetadata-dependencies` → `airflow`              | Runs OpenMetadata's ingestion pipelines (metadata/profiler/lineage extraction jobs) on a schedule. OpenMetadata talks to it over its "pipeline service client" API rather than the user interacting with Airflow directly.                                                                                                                                                                                                                                 |
| **Ingestion image** (`acs-openmetadata/Dockerfile`) | `{{registry}}/openmetadata-ingestion:1.13.3-patched` | The image Airflow's workers actually run. Built here from upstream's `openmetadata/ingestion` image with two fixes baked in - see [Troubleshooting](#troubleshooting).                                                                                                                                                                                                                                                                                     |

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
  version: 1.13.3
  repository: https://helm.open-metadata.org/
  condition: openmetadata.enabled
- name: openmetadata-dependencies
  version: 1.13.3
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

### Fix: large / fragile pip installation

By default the `openmetadata-dependencies` Airflow chart installs
`apache-airflow-providers-fab==2.4.4` at **container start** via the
`_PIP_ADDITIONAL_REQUIREMENTS` env var (a workaround for an Airflow 3 + MySQL
`CREATE INDEX IF NOT EXISTS` incompatibility). Doing this at runtime is slow
(a multi-minute pip resolve/install on every pod start) and fragile (any
transient PyPI/network hiccup fails the pod). Instead, `acs-openmetadata/Dockerfile`
pre-installs the same package at **build time**:

```dockerfile
FROM openmetadata/ingestion:1.13.3
RUN pip install --no-cache-dir "apache-airflow-providers-fab==2.4.4"
```

and `deploy/values.yaml` disables the runtime install so it doesn't happen
twice:

```yaml
openmetadata-dependencies:
  airflow:
    env:
      - name: _PIP_ADDITIONAL_REQUIREMENTS
        value: "" # Empty string disables the fragile runtime pip installation step
```

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

This is a separate fix from the OpenMetadata **server** image's own bundled
log4j (`/opt/openmetadata/libs`) - that's a different upstream image
(`docker.getcollate.io/openmetadata/server`, not `openmetadata/ingestion`),
patched independently. See
[acs-openmetadata-server/README.md](../acs-openmetadata-server/README.md).

### Building and pushing the patched image

Requires the [`crane`](https://github.com/google/go-containerregistry) CLI on
`PATH` in addition to `docker buildx` - see below.

```sh
cd acs-openmetadata
make build
```

`make build` (via `mk/acs.docker.mk`) runs
`docker buildx build --push --platform linux/amd64 -t <registry>/openmetadata-ingestion:1.13.3-patched .`,
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

The `version` in the `Makefile` is pinned to `1.13.3` on purpose (not the
usual `?=` override) - it tracks the upstream `openmetadata/ingestion`
version this Dockerfile patches, not ACS's own release version, so it must
not follow `config.mk`'s `version=` override for ACS's own services. The
resulting tag is what `deploy/values.yaml` references:

```yaml
openmetadata-dependencies:
  airflow:
    images:
      airflow:
        repository: <registry>/openmetadata-ingestion
        tag: 1.13.3-patched
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

With `LocalExecutor`, only the scheduler pod ever touches the DAGs/logs
volumes, so a plain `ReadWriteOnce` PVC is sufficient.

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
