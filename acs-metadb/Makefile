top=..
include ${top}/mk/acs.init.mk

repo?=acs-metadb
k8s.deployment?=metadb

build_args+=	--build-arg mvn_output=${zip}

include ${mk}/acs.docker.mk
include ${mk}/acs.mvn.mk

zip!=	${mvn} -q help:evaluate -Dexpression=acs.output -DforceStdout

.PHONY: mvn.compile mvn.package shell run

build: mvn.package

mvn.compile:
	${mvn} compile

mvn.package:
	${mvn} package

jshell: mvn.compile
	${mvn} jshell:run

exec: mvn.compile
	${mvn} exec:exec
