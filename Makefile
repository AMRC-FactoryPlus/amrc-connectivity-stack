# On Windows try https://frippery.org/busybox/

-include config.mk

pkgver!=node -e 'console.log(JSON.parse(fs.readFileSync("package.json")).version)'

version?=v${pkgver}
suffix?=
registry?=ghcr.io/amrc-factoryplus
repo?=acs-service-setup
docker?=docker
kubectl?=kubectl

tag=${registry}/${repo}:${version}${suffix}

build_args=

ifdef acs_base
build_args+=--build-arg acs_base="${acs_base}"
endif

ifdef acs_npm
build_args+=--build-arg acs_npm="${acs_npm}"
endif

all: build push

.PHONY: all build push check-committed pull

check-committed:
	[ -z "$$(git status --porcelain)" ] || (git status; exit 1)

pull:
	git pull --ff-only

lint:
	npx eslint bin lib

build: check-committed pull lint
	${docker} build -t "${tag}" ${build_args} .

push:
	${docker} push "${tag}"

run:
	${docker} run -ti --rm "${tag}" /bin/sh

.PHONY: deploy run-job logs

ifdef job_name

deploy: all run-job logs

run-job:
	kubectl create -f service-setup.yaml

logs:
	kubectl logs -f job/"${job_name}"

else

deploy run-job logs:
	: Set $${job_name} for automatic k8s deployment

endif
