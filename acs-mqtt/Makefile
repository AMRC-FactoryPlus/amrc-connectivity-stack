-include config.mk

registry?=	ghcr.io/amrc-factoryplus
repository?=	acs-mqtt
version?= 	v1.1.1
suffix?=

image=	${registry}/${repository}:${version}${suffix}
env= 	JAVA_HOME='${JAVA_HOME}' M2_HOME='${M2_HOME}' M2='${M2_HOME}/bin'
mvn=	'${M2_HOME}'/bin/mvn

pluginver!=	cd hivemq-krb && \
	${env} ${mvn} -q help:evaluate -Dexpression=project.version -DforceStdout
zip=hivemq-auth-krb-${pluginver}-distribution.zip


.PHONY: all build-plugin build-image update

all:	build-plugin build-image

update:
	git submodule update --remote

build-plugin:
	cd hivemq-krb && ${env} ${mvn} -B package
	cp hivemq-krb/target/${zip} .

build-image:
	docker build -t ${image} --build-arg krb_zipfile=${zip} .
	docker push ${image}
