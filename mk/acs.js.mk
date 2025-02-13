# Include this Makefile for JS services

ifndef .acs.js.mk
.acs.js.mk=1

base_image?=	ghcr.io/amrc-factoryplus/acs-base-js-build
base_version?=	${git.tag}

build_args+=	--build-arg base_version="${base_version}"
build_args+=	--build-context lib=../lib

ifdef acs_npm
build_args+=	--build-arg acs_npm="${acs_npm}"
endif

.PHONY: js.npminstall js.eslint update js.update

build: lint

setup: js.npminstall

js.npminstall:
	npm install --no-save

ifdef eslint
lint: js.eslint

js.eslint: js.npminstall
	npx eslint ${eslint}
endif

update:	js.update
	@:

js.update: git.check-committed
	npm update
	git add .
	git commit -m "npm update $$(git rev-parse --show-prefix)"

.PHONY: dev js.dev

dev: js.dev
	@:

js.dev:
	docker run --rm -ti -w /local \
		-v $$(pwd):/local -v $${HOME}/.npmrc:/home/node/.npmrc \
		${base_image}:${base_version} /bin/sh

include ${mk}/acs.docker.mk

endif
