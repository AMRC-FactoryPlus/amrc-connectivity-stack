top=..
include ${top}/mk/acs.init.mk

repo?=acs-edge
# Don't set k8s.deployment, the deployment doesn't have a fixed name.

platform?=	linux/amd64,linux/arm64

include ${mk}/acs.js.mk

local.build:
	npm install
	npx tsc --project tsconfig.json

local.run: local.build
	node build/app.js
