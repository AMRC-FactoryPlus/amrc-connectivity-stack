# Include this Makefile for JS services

ifndef .acs.js.mk
.acs.js.mk=1

base_version?=${git.tag}

js.pkglock?=	node_modules/.package-lock.json

build_args+=	--build-arg base_version="${base_version}"

ifdef acs_npm
build_args+=	--build-arg acs_npm="${acs_npm}"
endif

ifdef eslint
.PHONY: js.lint

lint: js.eslint

js.eslint: ${js.pkglock}
	npx eslint ${eslint}
endif

${js.pkglock}: package.json
	npm install

include ${mk}/acs.docker.mk

endif
