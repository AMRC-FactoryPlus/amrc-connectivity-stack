# Include this Makefile for JS services

ifndef .acs.js.mk
.acs.js.mk=1

base_version?=${git.tag}

build_args+=	--build-arg base_version="${base_version}"

ifdef acs_npm
build_args+=	--build-arg acs_npm="${acs_npm}"
endif

.PHONY: lint update

build: lint

lint:
	@:

ifdef eslint
lint: js.eslint

js.eslint:
	npx eslint ${eslint}
endif

update:	js.update
	@:

js.update: git.check-committed
	npm update
	git add .
	git commit -m "npm update $$(git rev-parse --show-prefix)"

include ${mk}/acs.docker.mk

endif
