top=..
include ${top}/mk/acs.init.mk

repo?=acs-metadb
k8s.deployment?=metadb

build_args+=	--build-arg jar=acs-metadb-0.1-SNAPSHOT.jar

include ${mk}/acs.docker.mk
include ${mk}/acs.mvn.mk

.PHONY: mvn.compile mvn.package shell run

build: mvn.package

mvn.compile:
	${mvn} compile

mvn.package:
	${mvn} -B package

jshell: mvn.compile
	${mvn} jshell:run

exec: mvn.compile
	${mvn} exec:exec
