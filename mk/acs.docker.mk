# Make rules for building Docker images

ifndef .acs.docker.mk
.acs.docker.mk=1

version?=${git.tag}
registry?=ghcr.io/amrc-factoryplus
suffix?=

tag=${registry}/${repo}:${version}${suffix}

build_args+=	--build-arg revision="${git.tag} (${git.sha})"

# `git rev-parse HEAD:directory` gives a SHA for the contents of that
# directory. In particular, it changes only when changes are made to
# that directory. This might be usable to only rebuild when the source
# has changed, or even to retag an existing image from the same
# source...

.PHONY: dkr.build push run

all: build push

build: git.prepare dkr.build

dkr.build:
	docker build -t "${tag}" ${build_args} .

push:
	docker push "${tag}"

run:
	docker run -ti --rm "${tag}" /bin/sh

include ${mk}/acs.git.mk
include ${mk}/acs.k8s.mk

endif
