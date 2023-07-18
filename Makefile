# On Windows try https://frippery.org/busybox/

-include config.mk

pkgver!=node -e 'console.log(JSON.parse(fs.readFileSync("package.json")).version)'

version?=${pkgver}
suffix?=
registry?=ghcr.io/amrc-factoryplus
repo?=acs-directory

tag=${registry}/${repo}:${version}${suffix}
build_args=

ifdef acs_base
build_args+=--build-arg acs_base="${acs_base}"
endif

ifdef acs_npm
build_args+=--build-arg acs_npm="${acs_npm}"
endif

all: build push

.PHONY: all build push check-committed

check-committed:
	[ -z "$$(git status --porcelain)" ] || (git status; exit 1)

build: check-committed
	docker build -t "${tag}" ${build_args} .

push:
	docker push "${tag}"

run:
	docker run -ti --rm "${tag}" /bin/sh

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
