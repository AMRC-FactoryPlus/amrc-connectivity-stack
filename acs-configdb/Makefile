top=..
include ${top}/mk/acs.init.mk

eslint=	bin lib editor

repo?=acs-configdb
k8s.deployment?=configdb

include ${mk}/acs.js.mk

schema:
	node bin/compile-schema.js
