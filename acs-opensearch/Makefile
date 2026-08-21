top=..
include ${top}/mk/acs.init.mk

repo?=opensearch
# Hard-set (not ?=): this tracks the upstream opensearchproject/opensearch
# version this Dockerfile patches, not ACS's own release version, so it
# must not follow config.mk's version= override for ACS's own services.
version=3.8.0
suffix?=-patched
# Flatten after push: the Dockerfile removes the upstream log4j jars, but a
# plain layered image only whiteouts them - the old bytes are still on disk
# in the base image's layer. Flattening collapses that away. See
# mk/acs.docker.mk and README.md.
flatten=1

include ${mk}/acs.docker.mk
