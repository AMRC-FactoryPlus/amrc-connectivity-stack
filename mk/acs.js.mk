# Include this Makefile for JS services

ifndef .acs.js.mk
.acs.js.mk=1

base_version?=${git.tag}

build_args+=	--build-arg base_version="${base_version}"

ifdef acs_npm
build_args+=	--build-arg acs_npm="${acs_npm}"
endif

ifdef eslint
.PHONY: js.lint

lint: js.eslint

js.eslint:
	npx eslint ${eslint}
endif

include ${mk}/acs.docker.mk

endif
