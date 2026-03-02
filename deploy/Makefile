top=..
include ${top}/mk/acs.init.mk

repo=	amrc-connectivity-stack

include ${mk}/acs.oci.mk

ifndef helm.version
helm.version!=	echo "${tag}" | sed -e's/^v//'
endif

helm.package=	${repo}-${helm.version}.tgz

.PHONY: package push helm.lint helm.clean

all: package push

package: helm.clean
	helm dependency build
	helm package --version ${helm.version} .

push:
	helm push ${helm.package} oci://${registry}

lint: helm.lint

helm.lint:
	helm lint .

clean: helm.clean

helm.clean:
	rm -f *.tgz
