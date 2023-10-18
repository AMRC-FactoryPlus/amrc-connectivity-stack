# On Windows try https://frippery.org/busybox/

-include config.mk

version?=1.2.0
suffix?=
registry?=ghcr.io/amrc-factoryplus
repo?=acs-kerberos-keys

tag=${registry}/${repo}:${version}${suffix}

all: build push

.PHONY: all build push run

build:
	[ -z "$$(git status --porcelain)" ] || (git status; exit 1)
	docker build -t "${tag}" .

push:
	docker push "${tag}"

run:
	docker run -ti --rm -v "$$(pwd)":/local "${tag}" /bin/sh


ifdef deployment

.PHONY: deploy restart logs

deploy: all restart logs

restart:
	kubectl rollout restart deploy/"${deployment}"
	kubectl rollout status deploy/"${deployment}"
	sleep 2

logs:
	kubectl logs -f deploy/"${deployment}" -c operator

else

deploy:
	: Set $${deployment} for automatic k8s deployment

endif
