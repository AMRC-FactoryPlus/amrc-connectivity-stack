# On Windows try https://frippery.org/busybox/

-include config.mk

release!=git describe --tags --abbrev=0

version?=${release}
suffix?=
base_version?=${release}
registry?=ghcr.io/amrc-factoryplus
repo?=acs-git
docker?=docker

tag=${registry}/${repo}:${version}${suffix}
build_args=

build_args+=--build-arg base_version="${base_version}"

ifdef acs_npm
build_args+=--build-arg acs_npm="${acs_npm}"
endif

all: build push

.PHONY: all build push check-committed lint amend

check-committed:
	[ -z "$$(git status --porcelain)" ] || (git status; exit 1)

lint:
	npx eslint bin lib

amend:
	git commit -a -C HEAD --amend

build: check-committed lint
	${docker} build -t "${tag}" ${build_args} .

push:
	${docker} push "${tag}"

run:
	${docker} run -ti --rm "${tag}" /bin/sh

.PHONY: deploy restart logs

ifdef deployment

deploy: all restart logs

restart:
	kubectl rollout restart deploy/"${deployment}"
	kubectl rollout status deploy/"${deployment}"
	sleep 2

logs:
	kubectl logs -f deploy/"${deployment}"

else

deploy restart logs:
	: Set $${deployment} for automatic k8s deployment

endif
