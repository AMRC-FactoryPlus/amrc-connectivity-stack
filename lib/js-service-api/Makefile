# Makefile for JS libraries

base=	ghcr.io/amrc-factoryplus/acs-base-js-build:v3.0.0

-include config.mk

all:

.PHONY: all dev

check-committed:
	[ -z "$$(git status --porcelain)" ] || (git status; exit 1)

lint:
	npx eslint lib

publish: check-committed lint
	npm version prerelease
	npm publish

amend:
	git commit -C HEAD -a --amend

dev:
	docker run --rm -ti -w /local \
		-v $$(pwd):/local -v $${HOME}/.npmrc:/home/node/.npmrc \
		${base} /bin/sh

pubdev: check-committed lint
	sh ./tools/pub-dev.sh "${js.dev_tag}"
