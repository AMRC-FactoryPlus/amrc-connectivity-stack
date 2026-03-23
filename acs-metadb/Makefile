top=..
include ${top}/mk/acs.init.mk

include ${mk}/acs.mvn.mk

all:
	${mvn} -B compile

shell: all
	${mvn} jshell:run

run: all
	${mvn} exec:exec
