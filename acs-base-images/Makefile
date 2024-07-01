top=..
include ${top}/mk/acs.init.mk

# We aren't using acs.docker.mk, so these all need to be here too
version?=${git.tag}
registry?=ghcr.io/amrc-factoryplus
repo?=acs-base
suffix?=

images=		js-build js-run pg-build pg-run
tag.base=	${registry}/${repo}
tag.version=	${version}${suffix}

build_args+=	--build-arg base=${tag.base}
build_args+= 	--build-arg version=${tag.version}

include ${mk}/acs.git.mk

.PHONY: img.build push

all: build push

# Yuck. This is where I miss BSD make...
build: git.prepare img.build

img.build:
	for i in ${images}; do \
	    t="${tag.base}-$$i:${tag.version}"; \
	    docker build -t $$t -f Dockerfile.$$i ${build_args} .; \
	done

push:
	for i in ${images}; do \
	    t="${tag.base}-$$i:${tag.version}"; \
	    docker push $$t; \
	done

