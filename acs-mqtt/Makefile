top=..
include ${top}/mk/acs.init.mk

repo?=acs-mqtt
k8s.deployment?=mqtt

src=	../hivemq-krb

pluginver!=	cd ${src} && \
	${mvn} -q help:evaluate -Dexpression=project.version -DforceStdout

zip=hivemq-auth-krb-${pluginver}-distribution.zip

build_args+=	--build-arg krb_zipfile=${zip}

include ${mk}/acs.docker.mk
include ${mk}/acs.mvn.mk

.PHONY: build-plugin

build: build-plugin

build-plugin: git.prepare
	cd ${src} && ${mvn} -B package
	cp ${src}/target/${zip} .
