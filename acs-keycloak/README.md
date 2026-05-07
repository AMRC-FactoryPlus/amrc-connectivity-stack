# acs-keycloak

Custom Keycloak image with the Factory+ User Storage SPI baked in.
The image is `FROM quay.io/keycloak/keycloak:26.1.1` plus the SPI jar
from `../acs-keycloak-spi/` copied into `/opt/keycloak/providers/`.

This is what the Helm chart's `openid` deployment runs once the
`acs-keycloak` image is referenced (set via `deploy/values.yaml`'s
`openid.image.repository`).

## Build

    make build

Same pattern as every other ACS component (`mk/acs.docker.mk`).
Multi-context: pulls `lib` (for the parent POM) and `spi` (the SPI
source) as named build contexts.

## Why a custom image rather than mounting the jar at runtime?

The pitch's "Custom image, not initContainer jar mount" rabbit hole:
versioning the SPI alongside the rest of ACS, atomic upgrades, no
init-copy dance.
