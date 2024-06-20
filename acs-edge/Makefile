top=..
include ${top}/mk/acs.init.mk

repo?=acs-edge
# Don't set k8s.deployment, the deployment doesn't have a fixed name.

include ${mk}/acs.js.mk

local.build:
	npx tsc --project tsconfig.json

local.run: local.build
	node build/app.js
