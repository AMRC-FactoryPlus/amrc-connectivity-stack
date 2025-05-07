# Make rules for building Docker images

ifndef .acs.docker.mk
.acs.docker.mk=1

platform?=	linux/amd64

build_args+=	--build-arg revision="${git.tag} (${git.sha})"
build_args+=	--build-arg registry="${registry}"
build_args+=	--build-arg tag="${tag}"
build_args+=	--build-context lib=../lib

# `git rev-parse HEAD:directory` gives a SHA for the contents of that
# directory. In particular, it changes only when changes are made to
# that directory. This might be usable to only rebuild when the source
# has changed, or even to retag an existing image from the same
# source...

.PHONY: build pull run

all: build

build: git.prepare
	docker buildx build --push --platform "${platform}" -t "${image}" ${build_args} .

pull:
	docker pull "${image}"

run: pull
	docker run -ti --rm "${image}" /bin/sh

include ${mk}/acs.git.mk
include ${mk}/acs.k8s.mk
include ${mk}/acs.oci.mk

endif
