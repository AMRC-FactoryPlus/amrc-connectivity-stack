top=..
include ${top}/mk/acs.init.mk

repo?=edge-helm-charts

ifdef edge.pull_policy
build_args+=	--build-arg pullpolicy="${edge.pull_policy}"
endif

include ${mk}/acs.js.mk
