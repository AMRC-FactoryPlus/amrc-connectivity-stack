# Makefile for JS libraries

base=	ghcr.io/amrc-factoryplus/acs-base-js-build:v3.0.0

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
	docker run --rm -ti -v $$(pwd):/local -w /local ${base} /bin/sh
