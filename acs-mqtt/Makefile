top=..
include ${top}/mk/acs.init.mk

repo?=acs-mqtt
k8s.deployment?=mqtt

build_args+=	--build-arg mvn_output=${zip}

include ${mk}/acs.docker.mk
include ${mk}/acs.mvn.mk

zip!=	${mvn} -q help:evaluate -Dexpression=acs.output -DforceStdout

.PHONY: mqtt.build mqtt.clean

build: mqtt.build

mqtt.build: git.prepare
	${mvn} package

clean: mqtt.clean

mqtt.clean:
	rm -rf target
