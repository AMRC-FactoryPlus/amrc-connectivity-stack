top=.
include ${top}/mk/acs.init.mk

# The commented-out subdirs don't have Makefiles yet
subdirs=
#subdirs+=acs-activity-monitor
subdirs+=acs-admin
subdirs+=acs-auth
subdirs+=acs-base-images
subdirs+=acs-cluster-manager
subdirs+=acs-cmdesc
subdirs+=acs-configdb
subdirs+=acs-directory
subdirs+=acs-edge
subdirs+=acs-edge-sync
subdirs+=acs-git
subdirs+=acs-identity
subdirs+=acs-krb-keys-operator
subdirs+=acs-krb-utils
#subdirs+=acs-manager
subdirs+=acs-monitor
subdirs+=acs-mqtt
subdirs+=acs-service-setup
subdirs+=acs-visualiser
subdirs+=deploy
#subdirs+=hivemq-krb
subdirs+=influxdb-sparkplug-ingester

.PHONY: recurse sd.build sd.lint

recurse:
	+for d in ${subdirs}; do \
		echo [$$d]; \
		${MAKE} -C $$d ${sd.targ}; \
	done

all: sd.all

sd.all:
	+${MAKE} sd.targ=all recurse

build: sd.build

sd.build:
	+${MAKE} sd.targ=build recurse

lint: sd.lint

sd.lint:
	+${MAKE} sd.targ=lint recurse
