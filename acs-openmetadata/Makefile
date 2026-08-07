top=..
include ${top}/mk/acs.init.mk

repo?=openmetadata-ingestion
# Hard-set (not ?=): this tracks the upstream openmetadata/ingestion
# version this Dockerfile patches, not ACS's own release version, so it
# must not follow config.mk's version= override for ACS's own services.
version=1.13.3
suffix?=-patched
k8s.deployment?=openmetadata

include ${mk}/acs.docker.mk
