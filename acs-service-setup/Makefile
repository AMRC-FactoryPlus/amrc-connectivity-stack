top=..
include ${top}/mk/acs.init.mk

repo?=acs-service-setup

eslint=	bin lib

include ${mk}/acs.js.mk

lint: check-yaml

# check-yaml resolves UUID refs against the local @amrc-factoryplus/
# service-client copy in node_modules. With `--install-links` (the
# js.mk default) npm copies the lib at install time, so a stale
# node_modules misses recently-added UUIDs. Depend on js.npminstall
# (.PHONY, no-op if up-to-date) to guarantee a fresh copy before the
# YAML check runs.
check-yaml: js.npminstall
	node bin/check-yaml.js
