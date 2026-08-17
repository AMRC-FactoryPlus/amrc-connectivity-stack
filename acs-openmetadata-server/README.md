# OpenMetadata server image (log4j patch)

The OpenMetadata server itself is deployed via the `openmetadata` Helm chart
(see `/deploy/values.yaml`'s `openmetadata` block and
[`acs-openmetadata/README.md`](../acs-openmetadata/README.md) for the wider
OpenMetadata deployment). This is a separate image from the ingestion image
patched in `acs-openmetadata` - the server chart's default image is
`docker.getcollate.io/openmetadata/server`, built from OpenMetadata's own
Maven release tarball, not `openmetadata/ingestion`.

That upstream image bundles `log4j-core`/`log4j-api` 2.25.5 under
`/opt/openmetadata/libs`. This directory's `Dockerfile` patches the jars in
directly, the same way `acs-opensearch/Dockerfile` patches OpenSearch's
bundled log4j:

```dockerfile
FROM docker.getcollate.io/openmetadata/server:1.13.3

ARG LOG4J_VERSION=2.26.1

USER root
RUN rm -f /opt/openmetadata/libs/log4j-core-*.jar /opt/openmetadata/libs/log4j-api-*.jar
ADD --chown=openmetadata:openmetadata https://.../log4j-core-${LOG4J_VERSION}.jar /opt/openmetadata/libs/log4j-core-${LOG4J_VERSION}.jar
ADD --chown=openmetadata:openmetadata https://.../log4j-api-${LOG4J_VERSION}.jar  /opt/openmetadata/libs/log4j-api-${LOG4J_VERSION}.jar
USER openmetadata
```

log4j2's public API is stable across patch versions, so this is a safe
drop-in swap that doesn't require touching the OpenMetadata server itself.
`LOG4J_VERSION` is kept in sync with the version pinned in
`acs-openmetadata/Dockerfile` and `acs-opensearch/Dockerfile` - there's no
reason to track three different patched log4j versions across the three
images.

`ADD`'s remote-URL support is used to fetch the jars (rather than `curl`/
`wget`) because the upstream image is built on Alpine and doesn't ship
either tool. `USER root`/`USER openmetadata` bracket the patch because the
upstream image already drops privileges to the `openmetadata` user, and
that user doesn't own `/opt/openmetadata/libs` by default.

## Building and pushing the patched image

Requires the [`crane`](https://github.com/google/go-containerregistry) CLI on
`PATH` in addition to `docker buildx` - see below.

```sh
cd acs-openmetadata-server
make build
```

`make build` (via `mk/acs.docker.mk`) runs
`docker buildx build --push --platform linux/amd64 -t <registry>/openmetadata-server:1.13.3-patched .`,
then flattens the pushed image with `crane flatten`. `rm`-ing a file in a
Dockerfile only hides it behind a whiteout - the bytes are still present in
the upstream base image's layer underneath, which file-level vulnerability
scanners that walk a node's disk (rather than asking a registry to resolve
the image) will still flag. Flattening merges the layers into one via the
registry API so the removed jars are actually gone, not just masked; `crane`
preserves the image's config (`ENV`/`ENTRYPOINT`/`CMD`/`USER`/etc.)
unchanged - only the filesystem layers are affected. This is opted into via
`flatten=1` in this directory's `Makefile` and is a no-op for every other
ACS service's `make build`, since `mk/acs.docker.mk` only runs it when
`flatten` is set.

The `version` in the `Makefile` is pinned to `1.13.3` on purpose (not the
usual `?=` override) - it tracks the upstream `openmetadata/server` version
this Dockerfile patches, not ACS's own release version. The resulting tag is
what `deploy/values.yaml` references:

```yaml
openmetadata:
  image:
    repository: <registry>/openmetadata-server
    tag: "1.13.3-patched"
```

When upstream OpenMetadata ships a new release, bump the `FROM` tag here
(keeping it in sync with the `openmetadata`/`openmetadata-dependencies`
chart versions in `/deploy/Chart.yaml`, since the server image version and
chart `appVersion` are expected to match), rebuild, and update the tag in
`values.yaml` to match. If a future upstream release already bundles a fixed
log4j, this Dockerfile (and the custom image) can be dropped and
`values.yaml` pointed back at the stock
`docker.getcollate.io/openmetadata/server` image.
