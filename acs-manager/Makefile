top=..
include ${top}/mk/acs.init.mk

# This doesn't use acs.docker.mk because we build two images.
# Refactoring acs.docker.mk to support that is probably not worth it.

repo?=acs-manager

version?=${git.tag}
registry?=ghcr.io/amrc-factoryplus
suffix?=

base_version?=	v3.0.0

tag=${version}${suffix}
image=${registry}/${repo}:${tag}

platform?=	linux/amd64

k8s.deployment=	manager
k8s.container=	backend

#build_args+=	--build-arg revision="${git.tag} (${git.sha})"
#build_args+=	--build-arg tag="${tag}"
build_args+=	--build-arg base_version="${base_version}"
build_args+=	--build-arg build_version="${base_version}"

build_cmd=	docker buildx build --push
build_cmd+= 	--platform "${platform}" ${build_args}
build_cmd+=	-f .docker/Dockerfiles/Dockerfile

.PHONY: all build backend frontend

all: build

build: git.prepare backend frontend

backend:
	${build_cmd} -t ${image}-backend .

frontend:
	${build_cmd} -t ${image}-frontend --target production-frontend .

include ${top}/mk/acs.git.mk
include ${top}/mk/acs.k8s.mk
