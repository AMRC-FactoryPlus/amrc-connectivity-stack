# On Windows try https://frippery.org/busybox/

-include config.mk

version?=1.0.1
suffix?=
registry?=ghcr.io/amrc-factoryplus
repo?=acs-kerberos-keys

tag=${registry}/${repo}:${version}${suffix}

all: build push

.PHONY: all build push

build:
	docker build -t "${tag}" .

push:
	docker push "${tag}"


ifdef deployment

.PHONY: deploy restart logs

deploy: all restart logs

restart:
	kubectl rollout restart deploy/"${deployment}"
	sleep 3

logs:
	kubectl logs -f deploy/"${deployment}"

else

deploy:
	: Set $${deployment} for automatic k8s deployment

endif
