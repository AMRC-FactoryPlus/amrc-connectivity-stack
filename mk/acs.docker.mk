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
ifdef flatten
# `flatten` opts a service out of Docker's normal layer sharing: it
# collapses the just-pushed image into a single layer via the registry
# API, so a `rm` earlier in the Dockerfile actually removes the file's
# bytes rather than just hiding them behind a whiteout. `crane` preserves
# the image config (ENV/ENTRYPOINT/CMD/USER/etc.) unchanged - only the
# filesystem layers are merged. Unset (the default) for every service that
# doesn't need this.
	crane flatten -t "${image}" "${image}"
endif

pull:
	docker pull "${image}"

run: pull
	docker run -ti --rm "${image}" /bin/sh

include ${mk}/acs.git.mk
include ${mk}/acs.k8s.mk
include ${mk}/acs.oci.mk

endif
