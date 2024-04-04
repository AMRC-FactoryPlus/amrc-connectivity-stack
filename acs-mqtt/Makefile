top=..
include ${top}/mk/acs.init.mk

repo?=acs-mqtt
k8s.deployment?=mqtt

env= 	JAVA_HOME='${JAVA_HOME}' M2_HOME='${M2_HOME}' M2='${M2_HOME}/bin'
mvn?=	'${M2_HOME}'/bin/mvn

src=	../hivemq-krb

pluginver!=	cd ${src} && \
	${env} ${mvn} -q help:evaluate -Dexpression=project.version -DforceStdout

zip=hivemq-auth-krb-${pluginver}-distribution.zip

build_args+=	krb_zipfile=${zip}

include ${mk}/acs.docker.mk

.PHONY: build-plugin

build: build-plugin

build-plugin: git.prepare
	cd ${src} && ${env} ${mvn} -B package
	cp ${src}/target/${zip} .
