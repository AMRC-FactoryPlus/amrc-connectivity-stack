# Design: Cross-realm Kerberos login for the Keycloak SPI

## Problem

A user from a trusted foreign Kerberos realm cannot log in to an ACS
cluster, even when the Kerberos side is entirely working. Two things
stop them, and one of them also breaks fully qualified logins for local
users.

### 1. The realm gets lower-cased and the lookup misses

Keycloak lower-cases the username before it reaches a user storage
provider. `FPAuthBackedUserStore.applyDefaultRealm` passed anything
containing an `@` straight through, so a user typing
`me1ago@AMRC-FP.SHEF.AC.UK` arrived at Factory+ Auth as
`me1ago@amrc-fp.shef.ac.uk`. Factory+ Auth compares identity names with
exact string equality (`acs-auth/lib/dataflow.js`, `i.name == upn`), so
the lookup 410s and Keycloak reports `error="user_not_found"`.

This is not cross-realm specific. Any local user typing their full UPN
instead of their short name hit it. The short-name path worked only
because `default.realm` is configured with the correct casing and gets
appended after Keycloak has finished folding the input.

The comment at `KerberosPasswordValidator.java:37` claimed "same
realm-uppercase canonicalisation as the user lookup". That was false:
the validator upper-cased the realm, the lookup did not.

### 2. There is no principal to find

Cross-realm Kerberos trust is a KDC-level fact. Adding a realm and its
KDC to `krb5.conf` lets the AS-REQ route to the foreign KDC, and lets
this cluster obtain service tickets in that realm. It provisions nothing
in Factory+. A foreign user has no principal here, so even a correctly
cased lookup finds nothing, and the login fails before the password is
ever tested.

The rest of the Kerberos machinery already works. `KerberosPasswordValidator`
builds a `Krb5LoginModule` login with `refreshKrb5Config=true` and no
hardcoded KDC, so the AS-REQ routes by the realm in the principal name.
`JaasKerberosAuthenticator.spnegoTokenFor` derives the service principal
from the target URI's host, so it can obtain a ticket for an HTTP
service in another realm. Neither needed changing.

## Solution

### Realm casing: try verbatim, then retry with the realm upper-cased

`findByUsername` now builds a candidate list instead of a single name:

1. The result of `applyDefaultRealm(username)`, exactly as before. Short
   names still get `@<default.realm>` appended with its configured
   casing.
2. The same string with only the portion after the **last** `@`
   upper-cased. Skipped when identical to the first.

Each candidate goes through the existing `fetchUuidByIdentity` +
`fetchPrincipal` chain, in order. First hit wins, and a hit on the first
candidate costs no extra request.

Retry rather than unconditional upper-casing is deliberate. Uppercase
Kerberos realms are convention, not a rule, and a deployment whose realm
genuinely is lower case must keep working - that was the concern behind
the original pass-through-verbatim comment. Trying the verbatim form
first preserves that behaviour exactly.

**Known limitation:** only the realm portion is touched. An F+ identity
stored with capitals in the *user* portion (`Me1ago@REALM`) will still
not match, because Keycloak has already folded the case and the original
is unrecoverable. Store user portions in lower case.

### Trusted realms

Three new config properties on the federation component, alongside
`auth.url`, `default.realm` and the rest:

| Key | Meaning |
|---|---|
| `trusted.realms` | Comma-separated realm names. Empty or absent means no cross-realm support. This is the default, so the feature is inert until opted into. |
| `trusted.realm.auth.urls` | Comma-separated `REALM=https://auth.example.org` entries. A realm listed in `trusted.realms` with no entry here takes the mint-fresh path. |
| `trusted.realm.timeout.seconds` | Default `1.5`. See the timeout constraint below. |

The flat `REALM=url` encoding exists because Keycloak's component config
is a `Map<String, List<String>>` whose keys must all be declared in
`getConfigProperties()`. Dynamic per-realm keys are not expressible.

Realm matching is case-insensitive on both sides: the incoming realm has
been lower-cased by Keycloak, and the configured value may be typed
either way.

### Resolution when both casing candidates miss

Only when the local lookup has missed on every candidate **and** the
realm portion is in `trusted.realms`:

- **Realm has no auth URL (the recommended mode).** Return a provisional
  user whose UUID is *derived* from the UPN. No outbound call on this
  path at all. See "Derived principal UUIDs" below.
- **Realm has an auth URL.** Resolve the principal UUID from that
  realm's own Factory+ Auth service. `FPAuthBackedUserStore` is reused
  as its own remote client - it already performs exactly the two GETs
  and the SPNEGO authentication needed - constructed pointing at the
  remote base URL with the same `KerberosAuthenticator` and a null
  default realm. These remote stores are built once at construction,
  keyed by upper-cased realm, not per request. On success we return a
  **provisional** user carrying the home cluster's UUID and its own
  spelling of the UPN. This UUID is adopted verbatim; nothing is derived
  on this path.
- **Realm not trusted.** Return empty, exactly as before this feature
  existed.

Nothing is written anywhere during lookup. Lookup runs before the
password is checked, so it runs for unauthenticated callers.

### Provisional users and the write-after-authentication

`FactoryPlusUser` gained a `provisional` flag. `FactoryPlusUserStore`
gained one write:

```java
String admit(String upn, String uuid);
```

It `PUT`s the UPN (as a JSON string, since acs-auth parses bodies with
`express.json({strict: false})`) to `/v2/principal/{uuid}/kerberos` -
an existing endpoint guarded server-side by `WriteKrb` on that UUID
target - and returns the UUID used. The store already authenticates with
SPNEGO as `sv1openid`, so no new client was needed.

`FactoryPlusUserStorageProvider.isValid` calls it **after**
`passwordValidator.validate(...)` returns true, and only then. If
`admit` fails the login is rejected and the failure logged. Issuing a
session whose identity could not be persisted would hand out a token
carrying an `fp_principal_uuid` that nothing on the cluster recognises:
every F+ service would reject it and the user would see a working login
with no access and no explanation.

The provider detects provisional users by `instanceof` where possible,
falling back to an `fp_provisional` user attribute. The attribute exists
because by credential-validation time we may be behind one of Keycloak's
own `UserModel` wrappers, which is the same reason `fp_principal_uuid`
is exposed as an attribute. No protocol mapper reads `fp_provisional`,
so it never reaches a token.

`CachingFactoryPlusUserStore.admit` delegates and then invalidates. This
is load-bearing, not hygiene: the lookup that produced the provisional
user cached it under whatever string Keycloak passed in, typically a
lower-cased short name rather than the canonical UPN we admit under.
Leaving it would keep reporting the user as provisional for the full 60s
TTL, and any negatively cached miss would keep masking the principal we
just created. Invalidation therefore matches on the cached *value*
(username case-insensitively, or UUID) as well as the exact key.

### Derived principal UUIDs (the mint path)

On the mint path the UUID is not random. It is a **UUIDv5** - the RFC
4122 name-based, SHA-1 variant - derived from a fixed namespace and the
user's canonicalised UPN.

Two properties fall out of this that random minting cannot give:

1. **Every cluster agrees.** Compass, Wales, and anything stood up in
   five years' time all independently derive the same UUID for
   `me1ago@AMRC-FP.SHEF.AC.UK`, with no coordination and no outbound
   calls. The far cluster does not even have to exist.
2. **Admins can pre-grant.** The UUID can be computed and permissions
   attached *before* the user's first login, so they land with the
   access they need. With random minting, first login always lands with
   zero permissions and someone has to go and fix it afterwards. This
   is the main reason for the change.

#### The namespace

```
cb3714c4-c85c-482a-987b-408293aa141e
```

Randomly generated once, on 2026-07-27, and **fixed forever after**.
Changing it silently orphans every principal ever minted from it: the
same user would resolve to a different UUID, their existing grants would
attach to a principal nothing looks up any more, and there is no
migration short of re-pointing every identity record by hand. It is
pinned by a unit test for that reason.

#### The name input, exactly

The name hashed is the **canonicalised UPN** - byte for byte the same
string written into the F+ identity record:

- **Realm portion: upper-cased.**
- **User portion: exactly as received from Keycloak**, which in practice
  means lower-cased, because Keycloak folds the whole username before
  any provider sees it.
- Encoded UTF-8. No trailing whitespace, no other transformation.

So a user typing `Me1ago@amrc-fp.shef.ac.uk` is hashed as
`me1ago@AMRC-FP.SHEF.AC.UK`.

**Nothing local feeds into the input.** Not the default realm, not the
auth URL, not the cluster name. That is deliberate and load bearing: if
the input varied with local configuration, two clusters would derive
different UUIDs and the entire property would be lost.

#### Computing one by hand

To pre-grant, or to check what the cluster will derive:

```sh
python3 -c "import uuid; print(uuid.uuid5(uuid.UUID(
  'cb3714c4-c85c-482a-987b-408293aa141e'), 'me1ago@AMRC-FP.SHEF.AC.UK'))"
```

```
12bb7b35-16c8-572d-af5f-c1f312ec4ae8
```

That exact pair is pinned as a known-answer test in
`FPAuthBackedUserStoreTest`, so the implementation cannot drift from
what this command produces.

Implementation note: the JDK ships no v5 generator, and
`UUID.nameUUIDFromBytes` is **not** a substitute - it is MD5 and stamps
version 3. `uuidV5` does SHA-1 over the namespace's 16 raw bytes
followed by the UTF-8 name bytes, then sets the version nibble to 5 and
the RFC 4122 variant bits.

### Deviation from the brief: provisional users carry a UUID from lookup

The approved design said the mint-fresh path should return a provisional
user with a **null** UUID, minted inside `admit`. It is implemented with
the UUID minted at lookup time instead.

`FactoryPlusUserAdapter` derives Keycloak's federated storage id from
the F+ UUID. Keycloak re-reads the user by that id later in the same
login flow, which routes to `findByUuid`. A null UUID produces the
storage id `f:<component>:null`, so the re-read fails - after `admit`
has already written. The login would break at a point where the write
had succeeded.

Minting early is safe: the UUID is not persisted anywhere until the KDC
has confirmed the password. An unauthenticated caller can make us
generate throwaway UUIDs, which costs nothing. `admit` still accepts a
null UUID and mints one, so the interface matches the brief; the null
branch is defensive only.

### Error handling

| Situation | Behaviour |
|---|---|
| Remote resolve times out or 5xxs | Throws `FactoryPlusAuthException`. Keycloak fails the login rather than reporting `user_not_found`. "The home cluster is unreachable" and "no such user" are different answers and must not collapse into one. |
| Remote resolve returns 410 or 404 | The user genuinely does not exist at home. Empty result, negatively cached, login rejected. |
| Remote resolve returns 403 | The home cluster has not granted us `ReadKrb`. Fatal to the login, with an actionable message, and briefly cached. See below. |
| `admit` write fails | Login rejected, failure logged. |
| Realm trusted with no auth URL | Mint fresh. No outbound dependency. |

### Timeout constraint

This is the sharpest edge in the design.

Keycloak hard-limits user storage lookups to 3 seconds
(`ServicesUtils.timeBoundOne`). Exceeding it surfaces as an opaque
`InterruptedException`, not a clean timeout naming the service that was
slow. `acs-service-setup/lib/openid.js` already documents this on
`auth.timeout.seconds`, currently 2s.

The cross-realm resolve happens **in series** after the local miss, so
local + remote share that one budget. Hence the 1.5s default on
`trusted.realm.timeout.seconds`. 2 + 1.5 already overshoots slightly in
the absolute worst case, and anything larger reliably trips the limit.

**Neither value may be raised without lowering the other.** Comments to
that effect sit on both, in the SPI factory and in `openid.js`.

## Security posture

Auto-mirror is the approved behaviour: any valid credential in a trusted
realm yields a session, with zero permissions until an admin grants
some. What keeps it bounded:

- Only explicitly configured realms are ever resolved, and the default
  config trusts nothing.
- Nothing is written before the KDC confirms the password. This ordering
  is tested explicitly in `FactoryPlusUserStorageProviderTest`.
- Negative caching bounds how hard an unauthenticated caller can make us
  hammer a remote cluster. All the new paths go through
  `CachingFactoryPlusUserStore`.
- Revocation is the `ReadKrb` grant on the home cluster (see below).

Residual risk accepted: auth-DB growth from principals who log in once
and are never granted anything. No reaper is planned.

## Deployment

`deploy/values.yaml`, under `openid`:

```yaml
openid:
  trustedRealms: []
  #  - realm: AMRC-FP.SHEF.AC.UK
  #  # - realm: PARTNER.EXAMPLE.ORG
  #  #   authUrl: https://auth.partner.example.org
```

The chart renders this flat into `OPENID_TRUSTED_REALMS` and
`OPENID_TRUSTED_REALM_AUTH_URLS` on the service-setup job;
`ensure_factoryplus_federation` maps them onto the component config keys
following the existing idempotent update pattern.

`sv1openid` gains `Auth.Perm.ManageKerberos` (`WriteKrb`,
`327c4cc8-9c46-4e1e-bb6b-257ace37b0f6`) on Wildcard, in
`acs-service-setup/dumps/service-accounts.yaml` alongside its existing
`ReadKerberos` and `ReadACL` grants. `op1krbkeys` already holds the same
permission for the same reason: creating identities is its job.

(The brief pointed at `deploy/templates/auth/principals/service-clients.yaml`
for this grant. That file declares `KerberosKey` CRs, not permission
grants; the grants for `sv1openid` live in the service-accounts dump.)

## Choosing a mode

### Recommended: no `authUrl`, derived UUIDs

List the realm and nothing else. This is the default recommendation:

- Nothing to create or grant on the home cluster. No coordination with
  whoever runs it.
- No outbound call at login, so no dependency on the home cluster being
  up, reachable, or still existing.
- Every cluster derives the same UUID for the same person anyway, via
  the UUIDv5 scheme above, so identity is consistent across the estate
  without the far cluster being involved at all.
- Admins can pre-grant before first login.

The thing you give up is reusing the UUID the user already has *on their
home cluster*. Their derived UUID is consistent everywhere else, but it
is not the home cluster's one, so grants made on the home cluster do not
follow them.

### The alternative: `authUrl`, home-derived UUIDs

Take this only when you specifically need this cluster to reuse the
principal UUID the user already has at home - typically because the two
clusters are administered together and grants are expected to correlate.

The cost is not just configuration:

- Someone must create a principal for **this** cluster's
  `sv1openid@<CONSUMING-REALM>` on the **home** cluster.
- That principal must be granted `ReadKrb`
  (`e8c9c0f7-0d54-4db2-b8d6-cd80c45f6a5c`) there, with the scope
  consequences below.
- Logins from that realm now depend on the home cluster being reachable
  within the timeout budget.

### Pick one and stay: this is close to a one-way door

Switching modes later does not migrate anyone. If you start without an
`authUrl` and add one afterwards, users who have already logged in keep
their derived UUID while users logging in for the first time get
home-derived ones. The estate ends up split by *when each person first
signed in*, which is invisible until someone's permissions do not behave
as expected.

Converging afterwards means re-pointing identity records by hand. The
same applies in reverse. Decide before the first login, not after.

## Manual steps this does not automate

### On the home cluster: `ReadKrb` for the consuming cluster

Only needed for realms configured with an `authUrl`. The consuming
cluster's `sv1openid@<CONSUMING-REALM>` must exist as a principal on the
**home** cluster and hold `ReadKrb`
(`e8c9c0f7-0d54-4db2-b8d6-cd80c45f6a5c`) there.

Understand what this grant is before making it. `ReadKrb` is **not**
scopeable to individual principals. It can only be granted on Wildcard,
and acs-auth repurposes it as a blanket "read any identity" capability.
The comment at `acs-auth/lib/dataflow.js:273` states it directly:

```
/* ReadKrb is repurposed here as 'read any identity'. This is
 * now a blanket permission which can only be granted on
 * Wildcard. It permits reading all identity records, and
 * listing all identities. */
```

So the grant is not "let the consuming cluster look up the users who log
in there". It is "let the consuming cluster's Keycloak read and
enumerate **every identity record in the home cluster's auth service**",
as a standing capability, independent of who actually logs in and
whether anyone ever does.

This grant is also the revocation point for the whole trust
relationship: remove it and the consuming cluster can no longer resolve
home principals.

#### What happens when the grant is missing

The home cluster returns 403 and the login **fails**. It does not fall
back to minting a fresh local UUID. That fallback was considered and
rejected: it would defeat revocation (removing the grant would silently
degrade to minting rather than stopping anything) and would split the
estate into home-derived and locally-minted principals depending on when
each user happened to first log in.

This is the most likely setup mistake in the feature, and the fix lives
on a different cluster from the error, so the message names the missing
permission and its UUID, the SPI principal that was denied, and the
remote cluster that denied it. It also points at dropping the `authUrl`
as the alternative.

The denial is cached for 30 seconds, keyed by realm.
`CachingFactoryPlusUserStore` deliberately never caches exceptions, so
that a transient F+ blip cannot lock out lookups for a full TTL; that
reasoning is correct for 5xx and timeouts and is unchanged. A 403 is
different in kind - it is a standing configuration state, not a fault -
and lookup runs *before* password validation, so while misconfigured
anyone who can reach the login page could bounce one call off the remote
cluster per attempt just by typing foreign usernames. The denial cache
suppresses the outbound call without softening the failure: the login
still fails, with the same message.

### Cross-realm Kerberos trust itself

`krb5.conf` on the consuming cluster must list the foreign realm and its
KDC, and the two KDCs must share the cross-realm trust principals. None
of that is in scope for the chart.

## Follow-up

The mirrored principal gets no ConfigDB `Principal` object and no `Info`
name. Creating one would mean giving the SPI a ConfigDB client it does
not currently have, which is a larger change than this warrants. The
consequence is cosmetic: the principal appears in the ACL editor by its
UPN rather than a friendly name, which is sufficient to grant against.
Worth revisiting if cross-realm users become common.

## Testing

Unit tests cover the store (casing candidates, all five cross-realm
outcomes, the exception-not-empty distinction on remote failure,
`admit`'s wire format and failure modes), the cache (invalidation under
both the canonical and the Keycloak-supplied key), the factory's config
parsing, and the provider's admit ordering.

`FactoryPlusFederationIT` covers the provisional path against a real
Keycloak container. A second KDC is deliberately not stood up: the
cross-realm AS-REQ stays a manual verification, since the KDC side is
stock Kerberos and the cost of harnessing it far exceeds what it would
prove.

Manual verification, on a cluster with the trust already configured:

1. Set `openid.trustedRealms` and upgrade.
2. Log in to Keycloak as `user@FOREIGN.REALM`.
3. The login succeeds, and the user appears in the F+ ACL editor by
   their UPN with no permissions.
4. Grant them something in F+; it appears in `fp_permissions` on the
   next login (within the SPI's 60s cache TTL).
