# AMRC Connectivity Stack
# Top-level Makefile
#
# All Makefiles in this repo use POSIX make syntax. Please restrict any
# use of extensions to those supported by both GNU make and
# https://frippery.org/make, used on Windows.

top=.
include ${top}/mk/acs.init.mk

subdirs+= acs-admin
subdirs+= acs-auth
subdirs+= acs-cluster-manager
subdirs+= acs-cmdesc
subdirs+= acs-configdb
subdirs+= acs-directory
subdirs+= acs-edge
subdirs+= acs-edge-sync
subdirs+= acs-git
subdirs+= acs-identity
subdirs+= acs-krb-keys-operator
subdirs+= acs-krb-utils
subdirs+= acs-manager
subdirs+= acs-monitor
subdirs+= acs-mqtt
subdirs+= acs-service-setup
subdirs+= acs-visualiser
subdirs+= deploy
subdirs+= edge-bacnet
subdirs+= edge-helm-charts
subdirs+= edge-modbus
subdirs+= edge-test
subdirs+= edge-tplink-smartplug
subdirs+= historian-sparkplug
subdirs+= historian-uns
subdirs+= uns-ingester-sparkplug

all: git.check-committed
	env MAKE="${MAKE}" ${tools}/recurse all ${subdirs}

include ${mk}/acs.git.mk
