# syntax=docker/dockerfile:1
#
# Custom Keycloak image with the Factory+ User Storage SPI baked in.
# Multi-stage: a Maven container builds the SPI jar, then we copy it
# into Keycloak's providers/ directory so the SPI loads at startup.
#
# Build contexts (set via ../mk/acs.docker.mk + this module's Makefile):
#   * lib  -> ../lib (provides java-base-pom and the in-tree mvn repo)
#   * spi  -> ../acs-keycloak-spi (the SPI source tree)

ARG keycloak_version=26.1.1
ARG maven_image=docker.io/library/maven:3.9-eclipse-temurin-21
ARG revision=unknown

FROM ${maven_image} AS build

# Reproduce the lib/<x> + acs-keycloak-spi/ layout from the repo so
# the SPI's pom.xml's relativePath '../lib/java-base-pom' and acs.top
# property resolve to real directories.
WORKDIR /build
COPY --from=lib java-base-pom /build/lib/java-base-pom
COPY --from=lib mvn /build/lib/mvn
COPY --from=spi . /build/acs-keycloak-spi

WORKDIR /build/acs-keycloak-spi
RUN --mount=type=cache,target=/root/.m2/repository \
    mvn -B -DskipTests package

FROM quay.io/keycloak/keycloak:${keycloak_version}

ARG revision
LABEL org.opencontainers.image.source="https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack"
LABEL org.opencontainers.image.title="ACS Keycloak (with Factory+ SPI)"
LABEL org.opencontainers.image.revision="${revision}"

# Drop the SPI jar into Keycloak's provider scan path. Keycloak's
# `start --optimized=false` (set by the Helm chart) runs the build step
# at startup and discovers the providers via META-INF/services.
COPY --from=build /build/acs-keycloak-spi/target/acs-keycloak-spi-*.jar \
                  /opt/keycloak/providers/
