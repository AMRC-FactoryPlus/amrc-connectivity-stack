top=../..
include ${top}/mk/acs.init.mk

include ${mk}/acs.mvn.mk

all:
	${mvn} -B deploy

shell:
	${mvn} compile && ${mvn} jshell:run
