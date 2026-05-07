# acs-keycloak-spi

Factory+ User Storage SPI plugin for Keycloak. Provides a custom federation
source so Keycloak users, groups, and credential validation are backed by
the Factory+ auth service instead of Kerberos federation.

See `docs/plans/2026-05-07-keycloak-fp-user-storage-spi.md` for the pitch
and `docs/plans/2026-05-07-keycloak-fp-spi-plan.md` for the implementation
plan.

## Build

    mvn package

Output: `target/acs-keycloak-spi-<version>.jar`.

## Test

    mvn test       # unit tests only
    mvn verify     # unit + integration tests (Testcontainers, requires Docker)

## Status

Phase 1 (build skeleton + hello-world SPI). Not yet usable.
