top=..
include ${top}/mk/acs.init.mk

repo=	amrc-connectivity-stack

include ${mk}/acs.oci.mk

ifndef helm.version
helm.version!=	echo "${tag}" | sed -e's/^v//'
endif

helm.package=	${repo}-${helm.version}.tgz

all: package push

package:
	rm -f *.tgz
	helm dependency build
	helm package --version ${helm.version} .

push:
	helm push ${helm.package} oci://${registry}

lint: helm.lint

helm.lint:
	helm lint .
