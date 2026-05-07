top=..
include ${top}/mk/acs.init.mk

repo?=acs-keycloak
k8s.deployment?=openid

# acs.docker.mk's default build_args adds --build-context lib=../lib;
# we additionally need the SPI source tree so the Dockerfile's first
# stage can compile the jar.
build_args+= --build-context spi=../acs-keycloak-spi

include ${mk}/acs.docker.mk
