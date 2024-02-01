# On Windows try https://frippery.org/busybox/

-include config.mk

version?=v0.0.1
suffix?=
registry?=ghcr.io/amrc-factoryplus
base?=acs-base
docker?=docker

images=	js-build js-run pg-build pg-run

tag_start=${registry}/${base}-
tag_end=:${version}${suffix}
build_args=	--build-arg base=${registry}/${base} \
		--build-arg version=${version}${suffix}

ifdef acs_npm
build_args+=--build-arg acs_npm="${acs_npm}"
endif

all: build push

.PHONY: all build push check-committed amend

check-committed:
	[ -z "$$(git status --porcelain)" ] || (git status; exit 1)

amend:
	git commit -a -C HEAD --amend

build: check-committed
	for i in ${images}; do \
	    ${docker} build -t ${tag_start}$${i}${tag_end} \
	        -f Dockerfile.$${i} ${build_args} .; \
	done

push:
	for i in ${images}; do \
	    ${docker} push ${tag_start}$${i}${tag_end}; \
	done

