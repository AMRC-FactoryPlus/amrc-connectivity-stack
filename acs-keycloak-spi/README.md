# acs-keycloak-spi

Custom Keycloak User Storage SPI plugin that federates users, groups,
and credential validation from the Factory+ auth service. Replaces
Keycloak's Kerberos federation as the source of user identity, so
Factory+ becomes the single source of truth for downstream OIDC
consumers (Grafana, acs-i3x, future shims).

See:
- Pitch: `docs/plans/2026-05-07-keycloak-fp-user-storage-spi.md`
- Implementation plan: `docs/plans/2026-05-07-keycloak-fp-spi-plan.md`
- Cross-realm design: `docs/plans/2026-07-27-keycloak-spi-cross-realm-design.md`

## Status

In production since ACS v6. The plugin:

- Loads in Keycloak as the `factoryplus` user storage provider, and is
  provisioned as the realm's federation by `acs-service-setup`
- Resolves users from the Factory+ auth service over its v2 identity API,
  authenticating with SPNEGO as `sv1openid`
- Validates passwords against the KDC via `Krb5LoginModule`
- Stamps `fp_principal_uuid` and `fp_permissions` into issued tokens via
  its two protocol mappers
- Caches hits and misses for a configurable TTL
- Accepts logins from configured foreign Kerberos realms (off by default;
  see Cross-realm login below)

It does not:
- Support email lookup (Factory+ has no email field)
- Support free-text user search, arbitrary user attributes, or group
  membership queries
- Write to Factory+, other than mirroring a cross-realm user's Kerberos
  identity after their password has validated

## Configuration

Set on the federation component. `acs-service-setup/lib/openid.js`
populates all of these from the Helm chart, so on a normal ACS
deployment you configure them through `values.yaml` rather than by hand.

| Key | Default | Meaning |
|---|---|---|
| `auth.url` | (blank) | Base URL of the Factory+ auth service. Blank disables F+ lookups entirely: the federation loads but returns no users. |
| `auth.timeout.seconds` | `2` | Per-request timeout for F+ auth calls. **Must stay under 3s**, see below. |
| `cache.ttl.seconds` | `60` | How long to cache lookups, including misses. `0` disables caching. |
| `auth.principal` | (blank) | Principal the SPI authenticates as, e.g. `sv1openid@FACTORYPLUS.LOCAL`. Blank calls F+ unauthenticated, which is only useful against a stand-in server. |
| `auth.keytab.path` | (blank) | Keytab holding credentials for that principal. Must be readable by Keycloak's process. |
| `default.realm` | (blank) | Realm appended to usernames typed without an `@realm` suffix, so local users can log in with a short name. |
| `trusted.realms` | (blank) | Comma-separated Kerberos realms accepted for cross-realm login. Blank means none. |
| `trusted.realm.auth.urls` | (blank) | Comma-separated `REALM=url` entries naming each trusted realm's own F+ auth service. |
| `trusted.realm.timeout.seconds` | `1.5` | Per-request timeout for calls to a trusted realm's auth service. |

### The 3-second budget

Keycloak hard-kills user storage lookups at 3 seconds, and overshooting
surfaces as an opaque `InterruptedException` rather than a timeout
naming the slow service. The cross-realm resolve runs **in series**
after the local lookup misses, so `auth.timeout.seconds` and
`trusted.realm.timeout.seconds` share that one budget. Do not raise
either without lowering the other.

### Username casing

Keycloak lower-cases the username before it reaches the provider. The
SPI tries the resulting UPN verbatim first, then retries with the realm
portion (everything after the last `@`) upper-cased. That covers both
the usual uppercase realms and deployments whose realm genuinely is
lower case.

Only the realm is touched. An F+ identity stored with capitals in the
**user** portion (`Me1ago@REALM`) cannot be matched, because the
original casing is gone by the time we see it. Store user portions in
lower case.

## Cross-realm login

With `trusted.realms` set, a user from a listed realm can sign in with
no pre-existing Factory+ principal on this cluster. Once their home KDC
accepts the password, the SPI writes their Kerberos identity here and
they appear in the ACL editor by their UPN, with no permissions until an
admin grants some. Nothing is written before the KDC has confirmed the
password.

This is off by default and requires cross-realm Kerberos trust to
already exist: the realm and its KDC must be in `krb5.conf` on this
cluster. Listing a realm here does not create that trust.

There are two modes. Pick deliberately, and see the one-way-door warning
at the end.

### Recommended: no `authUrl`, derived UUIDs

List the realm and nothing else. The principal UUID is derived from the
user's UPN as a UUIDv5, which means:

- No principal to create and no permission to obtain on the home
  cluster. No coordination with whoever runs it.
- No outbound call at login, so no dependency on the home cluster being
  up, reachable, or still existing.
- Every ACS cluster derives the *same* UUID for the same person, with no
  coordination, so identity stays consistent across the estate anyway.
- **Admins can pre-grant**: compute the UUID and attach permissions
  before the user has ever logged in, so their first login works
  properly instead of landing with nothing.

What you give up is reusing the UUID the user has *on their home
cluster*, so grants made there do not follow them here.

#### Computing a UUID to pre-grant

```sh
python3 -c "import uuid; print(uuid.uuid5(uuid.UUID(
  'cb3714c4-c85c-482a-987b-408293aa141e'), 'me1ago@AMRC-FP.SHEF.AC.UK'))"
```

```
12bb7b35-16c8-572d-af5f-c1f312ec4ae8
```

The name you hash is the **canonicalised UPN**: realm portion in
CAPITALS, user portion exactly as the person types it into the login
form (which Keycloak lower-cases, so in practice lower case). Nothing
local feeds into it - not the default realm, not the cluster name - and
that is what makes every cluster agree.

The namespace `cb3714c4-c85c-482a-987b-408293aa141e` is fixed forever.
Changing it would orphan every principal ever derived from it, so it is
pinned by a unit test, along with the example above as a known-answer
vector.

### The alternative: `authUrl`, home-derived UUIDs

Give the realm an entry in `trusted.realm.auth.urls` and the SPI
resolves the user's principal UUID from their home cluster, so they keep
that cluster's identity here. Take this only when you specifically need
that - typically because the two clusters are administered together and
grants are expected to correlate.

This requires manual setup **on the home cluster**: the consuming
cluster's `sv1openid@<CONSUMING-REALM>` must exist as a principal there
and hold `ReadKrb` (`e8c9c0f7-0d54-4db2-b8d6-cd80c45f6a5c`). Logins from
that realm then also depend on the home cluster being reachable within
the timeout budget.

Know what you are granting. `ReadKrb` cannot be scoped to individual
principals - it can only be granted on Wildcard, and acs-auth treats it
as a blanket "read any identity" capability (see the comment at
`acs-auth/lib/dataflow.js:273`). The grant lets the consuming cluster's
Keycloak **read and enumerate every identity record in the home
cluster's auth service**, as a standing capability, regardless of who
actually logs in or whether anyone ever does.

That grant is also the revocation point for the whole trust
relationship: remove it and the consuming cluster can no longer resolve
home principals.

Without the grant the home cluster returns 403 and the login **fails**.
It does not quietly fall back to deriving a UUID - that would defeat
revocation, and would leave you with some users on home-derived UUIDs
and some on derived ones depending on when they first logged in. The
logged message names the missing permission, the principal that was
denied and the cluster that denied it. A standing denial is cached for
30 seconds so it costs one outbound call rather than one per login
attempt; 5xx and timeouts stay uncached, since those are transient and
recovery should be immediate.

### Pick one and stay: switching later is close to a one-way door

Changing modes does not migrate anyone. Add an `authUrl` to a realm that
has been running without one and users who already logged in keep their
derived UUID, while first-time users get home-derived ones. The estate
splits by *when each person first signed in*, which stays invisible
until someone's permissions do not behave as expected. Converging
afterwards means re-pointing identity records by hand.

Decide before the first login from that realm, not after.

### On this cluster

`sv1openid` needs `WriteKrb` (`327c4cc8-9c46-4e1e-bb6b-257ace37b0f6`) on
Wildcard to mirror the identity. The Helm chart grants this
automatically via `acs-service-setup/dumps/service-accounts.yaml`.

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

Currently 115 unit tests across 10 classes, plus 4 integration tests in
`FactoryPlusFederationIT` (real Keycloak via Testcontainers).

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
