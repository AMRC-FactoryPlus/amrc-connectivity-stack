top=..
include ${top}/mk/acs.init.mk

repo?=acs-service-setup

eslint=	bin lib

include ${mk}/acs.js.mk

lint: check-yaml

check-yaml:
	node bin/check-yaml.js
