top=..
include ${top}/mk/acs.init.mk

repo?=acs-mqtt
k8s.deployment?=mqtt

src=	../hivemq-krb

build_args+=	--build-arg krb_zipfile=${zip}

include ${mk}/acs.docker.mk
include ${mk}/acs.mvn.mk

pluginver!=	cd ${src} && \
	${mvn} -q help:evaluate -Dexpression=project.version -DforceStdout

zip=hivemq-auth-krb-${pluginver}-distribution.zip

.PHONY: mqtt.build mqtt.clean

build: mqtt.build

mqtt.build: git.prepare
	cd ${src} && ${mvn} -B package
	cp ${src}/target/${zip} .

clean: mqtt.clean

mqtt.clean:
	rm -rf target
	rm -f ${zip}
