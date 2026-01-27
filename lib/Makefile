top=..
include ${top}/mk/acs.init.mk

# Subdirs to build. Only include subdirs which have a Makefile. Most are
# just referenced directly from the Docker builds, but the Java lib
# needs building.
subdirs+= java-service-client

# Repo dirs to manage in the local tree. Currently just Java.
repos+= mvn

include ${mk}/acs.subdirs.mk

.PHONY: mk-repo rm-repo

all: mk-repo

clean: rm-repo

mk-repo:
	mkdir -p ${repos}

rm-repo:
	rm -rf ${repos}
