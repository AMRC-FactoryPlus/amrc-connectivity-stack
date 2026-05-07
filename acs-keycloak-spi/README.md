# acs-keycloak-spi

Custom Keycloak User Storage SPI plugin that federates users, groups,
and credential validation from the Factory+ auth service. Replaces
Keycloak's Kerberos federation as the source of user identity, so
Factory+ becomes the single source of truth for downstream OIDC
consumers (Grafana, acs-i3x, future shims).

See:
- Pitch: `docs/plans/2026-05-07-keycloak-fp-user-storage-spi.md`
- Implementation plan: `docs/plans/2026-05-07-keycloak-fp-spi-plan.md`

## Status

**Phase 1 of 12 — build skeleton + hello-world SPI.**

The plugin currently:
- Loads in Keycloak as the `factoryplus` user storage provider
- Implements `UserLookupProvider` against an injectable `FactoryPlusUserStore`
- Ships with a `NullFactoryPlusUserStore` default that returns no users

It does NOT yet:
- Talk to a real Factory+ auth service (Phase 2)
- Implement group lookups, credential validation, or claim mappers
- Replace Kerberos federation in the Helm deployment

Refer to the plan doc for the full phase map.

## Build

```bash
mvn -B package
```

Output: `target/acs-keycloak-spi-<version>.jar`. The jar can be dropped
into a Keycloak instance's `/opt/keycloak/providers/` directory; on next
startup Keycloak will discover it via `META-INF/services` and offer
`factoryplus` as a User Federation option.

## Test

```bash
mvn -B test       # unit tests (no Docker required)
mvn -B verify     # unit + integration tests (Testcontainers, requires Docker)
```

The current Phase 1 test count is 17 unit tests (5 classes) + 2
integration tests in `FactoryPlusFederationIT` (real Keycloak via
Testcontainers).

### Running integration tests locally

The IT spins up a real `quay.io/keycloak/keycloak:26.1.1` container,
mounts the SPI jar into `/opt/keycloak/providers/`, and asserts the
provider loads and accepts a federation configuration. It needs a
reachable Docker daemon.

The IT auto-skips when Docker isn't found, so `mvn verify` is always
safe to run.

| Setup | Notes |
|---|---|
| Linux + Docker daemon | Just works (`/var/run/docker.sock`). |
| Docker Desktop (mac/Win/Linux) | Just works (Testcontainers detects the desktop socket). |
| **macOS + OrbStack/Colima/Rancher** | The CLI auto-starts the VM but Testcontainers does not. Start the VM first (`orb start`), then run with `DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock mvn -B verify`. Configuring OrbStack to start on login removes the daily friction. |
| GitHub Actions ubuntu-latest | Docker is preinstalled at the standard path; the IT runs without extra config. |

## Project layout

```
acs-keycloak-spi/
  pom.xml                                       Maven build, inherits lib/java-base-pom
  src/main/java/uk/co/amrc/app/factoryplus/keycloak/
    FactoryPlusUser.java                        Immutable DTO returned by the store
    FactoryPlusUserStore.java                   Read-only interface (uuid/username/email lookups)
    NullFactoryPlusUserStore.java               Default empty implementation, used until Phase 2
    FactoryPlusUserAdapter.java                 Wraps a DTO as Keycloak's UserModel
    FactoryPlusUserStorageProvider.java         Per-request provider; delegates to the store
    FactoryPlusUserStorageProviderFactory.java  SPI factory
  src/main/resources/META-INF/services/
    org.keycloak.storage.UserStorageProviderFactory   ServiceLoader registration
  src/test/java/uk/co/amrc/app/factoryplus/keycloak/
    *Test.java                                  Unit tests (Mockito + AssertJ)
  src/test/java/uk/co/amrc/app/factoryplus/keycloak/integration/
    FactoryPlusFederationIT.java                Testcontainers integration test
  src/test/resources/
    simplelogger.properties                     SLF4J config for test runtime
```

## How to add a new SPI capability (e.g. group lookup, claim mapper)

1. Pick the Keycloak interface to implement (e.g. `GroupLookupProvider`,
   `OIDCAttributeMapper`).
2. If it's a separate provider type (not just a method on the existing
   provider), add a new ServiceLoader registration file under
   `src/main/resources/META-INF/services/<fully.qualified.interface>`.
3. Write a failing unit test (Mockito-driven) for the new behaviour.
4. Implement, then run `mvn -B test` until green.
5. If you're touching the integration boundary (Keycloak's startup
   discovery, persistence, transactions), add an IT case in
   `FactoryPlusFederationIT` and run `mvn -B verify`.

The `FactoryPlusUserStore` interface is the seam that hides all
F+-side concerns from the SPI plumbing. Anything new that needs F+
data should grow that interface, not bypass it.

## Architecture (Phase 1)

```
Keycloak boot
    discovers META-INF/services -> FactoryPlusUserStorageProviderFactory

Realm admin adds 'factoryplus' federation
    Keycloak calls factory.create(session, model)
    factory hands provider a FactoryPlusUserStore (NullFactoryPlusUserStore for now)

User login lookup
    Keycloak calls provider.getUserByUsername(realm, "alice")
    provider delegates to store.findByUsername("alice")
    store returns Optional<FactoryPlusUser>
    provider wraps in FactoryPlusUserAdapter (UserModel)
    Keycloak presents the user to the rest of the auth flow
```

Phase 2 swaps `NullFactoryPlusUserStore.INSTANCE` for a Wiremock-backed
implementation that calls F+ over HTTP. No other change to this module
is required - the seam absorbs it.
