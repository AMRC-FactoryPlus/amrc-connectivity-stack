top=..
include ${top}/mk/acs.init.mk

repo=	amrc-connectivity-stack

include ${mk}/acs.oci.mk

# helm.version: optional override. If not set, derive from ${tag} by
# stripping a leading 'v' so we get a valid semver-ish chart version.
# The derivation runs at recipe time via $$(...) so the SHELL handles
# the substitution. We avoid `!=` (POSIX 2024 / GNU make 4+) because
# the macOS-default GNU make 3.81 and BSD make don't support it: they
# parse `helm.version!` as a literal variable name and leave the real
# `helm.version` undefined, producing an empty `--version` flag.
ifndef helm.version
helm.version=	$$(echo '${tag}' | sed -e 's/^v//')
endif

helm.package=	${repo}-${helm.version}.tgz

.PHONY: package push helm.lint helm.clean

all: package push

package: helm.clean
	helm dependency build
	helm package --version "${helm.version}" .

push:
	helm push "${helm.package}" oci://${registry}

lint: helm.lint

helm.lint:
	helm lint .

clean: helm.clean

helm.clean:
	rm -f *.tgz
