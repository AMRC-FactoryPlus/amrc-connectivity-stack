# AMRC Connectivity Stack Top-level Makefile
#
# All Makefiles in this repo use POSIX make syntax. Please restrict any
# use of extensions to those supported by both GNU make and
# https://frippery.org/make, used on Windows.
#
# To build the whole of ACS using this Makefile, run `make` from this
# directory. On Windows you can use WSL, the GNU make from Cygwin,
# MingW32 or installed with Git for Windows, or busybox from
# https://frippery.org/busybox. The last is the simplest to set up.
#
# Create a file `config.mk` in this directory to configure the build.
# This has `variable=value` lines; there is no quoting, the value
# continues to the end of the line. Useful config variables are:
#
# registry	Choose the container registry to push images to.
# This default to GHCR which you won't be able to push to.
#
# tag		Choose a tag for the images.
# This defaults to deriving a tag from `git describe`.
#
# base_version	The version of the ACS base images.
# These are not usually build by ACS builds. Set to `v3.0.0`.
#
# helm.version	The version to use for the Helm chart.
# Use this if `tag` ends up as an invalid semver; Helm is strict here.
#
# platform	Restrict the platforms to build for.
# You probably want `linux/amd64` to save time.
#
# You can also run `make` in any subdir to build just that image. This
# still reads `config.mk` at the top level.

top=.
include ${top}/mk/acs.init.mk

# lib must come first. Other subdirs depend on it.
subdirs+= lib

subdirs+= acs-admin
subdirs+= acs-auth
subdirs+= acs-cluster-manager
subdirs+= acs-cmdesc
subdirs+= acs-configdb
subdirs+= acs-directory
subdirs+= acs-edge
subdirs+= acs-edge-sync
subdirs+= acs-files
subdirs+= acs-git
subdirs+= acs-identity
subdirs+= acs-krb-keys-operator
subdirs+= acs-krb-utils
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

include ${mk}/acs.subdirs.mk
