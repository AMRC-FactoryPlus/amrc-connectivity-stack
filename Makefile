# On Windows try https://frippery.org/busybox/

-include config.mk

pkgver!=node -e 'console.log(JSON.parse(fs.readFileSync("package.json")).version)'

version?=${pkgver}
suffix?=
registry?=ghcr.io/amrc-factoryplus
repo?=acs-auth

tag=${registry}/${repo}:${version}${suffix}

all: build push

.PHONY: all build push check-committed

check-committed:
	[ -z "$$(git status --porcelain)" ] || (git status; exit 1)

build: check-committed
	docker build -t "${tag}" .

push:
	docker push "${tag}"

ifdef deployment

.PHONY: deploy restart logs

kdeploy=	deploy/"${deployment}"

deploy: all restart logs

restart:
	kubectl rollout restart ${kdeploy}
	kubectl rollout status ${kdeploy}
	sleep 2

logs:
	kubectl logs -f ${kdeploy}

else

deploy:
	: Set $${deployment} for automatic k8s deployment

endif
