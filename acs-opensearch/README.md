# OpenSearch image (log4j patch)

OpenSearch is deployed as part of the `openmetadata-dependencies` Helm chart
(see `/deploy/values.yaml`'s `openmetadata-dependencies.opensearch` block and
[`acs-openmetadata/README.md`](../acs-openmetadata/README.md) for the wider
OpenMetadata deployment). It isn't built by ACS - the chart just pulls the
upstream `opensearchproject/opensearch` image directly.

That upstream image bundles two independent, older copies of
`log4j-core`/`log4j-api` - affected by known log4j2 CVEs - and this
directory's `Dockerfile` patches both, the same way
`acs-openmetadata/Dockerfile` patches PySpark's bundled log4j for the
ingestion image:

- The main OpenSearch classpath under `/usr/share/opensearch/lib` (2.25.4).
- The Performance Analyzer agent's own classpath under
  `/usr/share/opensearch/performance-analyzer-rca/lib`. Performance Analyzer
  runs as a separate JVM process and loads its dependencies from
  `performance-analyzer-rca/lib` (set via
  `OPENSEARCH_ADDITIONAL_CLASSPATH_DIRECTORIES` in the upstream
  `performance-analyzer-agent-cli` script) rather than the main OpenSearch
  classpath, so it bundles its own separate log4j copy that patching
  `/usr/share/opensearch/lib` alone doesn't touch.

There is no newer upstream OpenSearch release (3.8.0 is current at time of
writing) that bundles a fixed log4j in either location, so both are patched
in directly:

```dockerfile
FROM opensearchproject/opensearch:3.8.0

ARG LOG4J_VERSION=2.26.1

USER root
RUN rm -f /usr/share/opensearch/lib/log4j-core-*.jar /usr/share/opensearch/lib/log4j-api-*.jar
ADD --chown=opensearch:opensearch https://.../log4j-core-${LOG4J_VERSION}.jar /usr/share/opensearch/lib/log4j-core-${LOG4J_VERSION}.jar
ADD --chown=opensearch:opensearch https://.../log4j-api-${LOG4J_VERSION}.jar  /usr/share/opensearch/lib/log4j-api-${LOG4J_VERSION}.jar

RUN rm -f /usr/share/opensearch/performance-analyzer-rca/lib/log4j-core-*.jar /usr/share/opensearch/performance-analyzer-rca/lib/log4j-api-*.jar
ADD --chown=opensearch:opensearch https://.../log4j-core-${LOG4J_VERSION}.jar /usr/share/opensearch/performance-analyzer-rca/lib/log4j-core-${LOG4J_VERSION}.jar
ADD --chown=opensearch:opensearch https://.../log4j-api-${LOG4J_VERSION}.jar  /usr/share/opensearch/performance-analyzer-rca/lib/log4j-api-${LOG4J_VERSION}.jar
USER opensearch
```

log4j2's public API is stable across patch versions, so this is a safe
drop-in swap that doesn't require touching OpenSearch itself. `LOG4J_VERSION`
is kept in sync with the version pinned in `acs-openmetadata/Dockerfile` -
there's no reason to track two different patched log4j versions across the
two images.

`ADD`'s remote-URL support is used to fetch the jars (rather than `curl`/
`wget`) because the upstream image is built on Amazon Linux 2023 and doesn't
ship either tool. `USER root`/`USER opensearch` bracket the patch because the
upstream image already drops privileges to the `opensearch` user, and that
user doesn't own `/usr/share/opensearch/lib` by default.

## Building and pushing the patched image

Requires the [`crane`](https://github.com/google/go-containerregistry) CLI on
`PATH` in addition to `docker buildx` - see below.

```sh
cd acs-opensearch
make build
```

`make build` (via `mk/acs.docker.mk`) runs
`docker buildx build --push --platform linux/amd64 -t <registry>/opensearch:3.8.0-patched .`,
then flattens the pushed image with
`crane flatten -t <registry>/opensearch:3.8.0-patched <registry>/opensearch:3.8.0-patched`.
`rm`-ing a file in a Dockerfile only hides it behind a whiteout - the bytes
are still present in the upstream base image's layer underneath, which
file-level vulnerability scanners that walk a node's disk (rather than
asking a registry to resolve the image) will still flag. Flattening merges
the layers into one via the registry API so the removed jars are actually
gone, not just masked; `crane` preserves the image's config
(`ENV`/`ENTRYPOINT`/`CMD`/`USER`/etc.) unchanged - only the filesystem layers
are affected. This is opted into via `flatten=1` in this directory's
`Makefile` and is a no-op for every other ACS service's `make build`, since
`mk/acs.docker.mk` only runs it when `flatten` is set.

The `version` in the `Makefile` is pinned to `3.8.0` on purpose (not the
usual `?=` override) - it tracks the upstream `opensearchproject/opensearch`
version this Dockerfile patches, not ACS's own release version. The
resulting tag is what `deploy/values.yaml` references:

```yaml
openmetadata-dependencies:
  opensearch:
    image:
      repository: opensearch
      tag: "3.8.0-patched"
```

When upstream OpenSearch ships a new minor/patch release, bump the `FROM`
tag here, rebuild, and update the tag in `values.yaml` to match. If a future
upstream release already bundles a fixed log4j, this Dockerfile (and the
custom image) can be dropped and `values.yaml` pointed back at the stock
`opensearchproject/opensearch` image.
