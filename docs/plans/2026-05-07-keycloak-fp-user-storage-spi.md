# Pitch: Factory+ as Keycloak's User Storage Source

## Problem

ACS now has Keycloak deployed alongside Factory+, federated to Kerberos so that
existing F+ users can sign in to Grafana via OIDC. It works, but it has
created two sources of truth for "who is a user and what can they do":

- **Factory+ auth service** owns principals, groups, ACL grants. This is where
  every other ACS service looks to decide what someone is allowed to do.
- **Keycloak** owns OIDC clients, per-client roles (`viewer`, `editor`,
  `admin`, `grafanaAdmin`) and the user-federation link to Kerberos.

The two are glued together by the Kerberos principal name, and each one has
authorization data the other does not see. The concrete pain points:

1. **Grafana's permissions are not driven by F+.** Today an admin assigns a
   user the `grafanaAdmin` role inside Keycloak. The same admin separately
   manages F+ groups and grants. The two never reconcile. Asked "can I add a
   F+ ACL grant that controls Grafana access?" the answer is no, you cannot,
   because Grafana never talks to the F+ auth service. It only ever sees the
   Keycloak `roles` claim.
2. **Every new OIDC consumer re-invents authorization.** The acs-i3x work that
   is being shaped right now needs a token-exchange shim purely because the
   JWT does not carry F+ identity. Anything else we add later (Manager UI on
   OIDC, a partner integration, a future northbound shim) hits the same wall.
3. **The Kerberos federation is a one-way READ_ONLY mirror.** F+ principals
   that get added through the F+ ACL editor only show up in Keycloak after a
   federated lookup, and Keycloak's view of the user has no F+ groups or
   grants. Admin operations split between two UIs.

The deeper version of the problem: in an ideal world ACS would have been
built on OAuth from day one. It was not, and replacing Kerberos wholesale is
out of the question (Sparkplug/MQTT depends on GSSAPI, krb-keys-operator
auto-provisions service identities, service-to-service delegation works).
But the *user-identity* path is much smaller and is the part Grafana, i3X,
and every future HTTP consumer actually cares about.

## Appetite

**Two months.** This is a deliberate big bet because flipping the source of
truth is much cheaper to do now (one OIDC consumer in production, Grafana,
plus one in flight, acs-i3x) than after a dozen partners have onboarded.

## Solution

Replace Keycloak's Kerberos user federation with a custom **Factory+ User
Storage SPI plugin**. Keycloak keeps doing all the OIDC heavy lifting
(authorization code, PKCE, token issuance, JWKS rotation, vendor
compatibility, session management, logout). What changes is where it gets
its users, groups, and credential validation from.

### The shape of it

```
Today
─────
  Kerberos KDC           (truth: users)
        │
        ▼  Keycloak Kerberos federation (READ_ONLY)
  Keycloak users + per-client roles
        │
        ▼  JWT { sub, roles[] }
  Grafana / acs-i3x

  F+ auth service        (truth: principals, groups, ACL grants)
        │
        ▼  ──── never reaches Grafana ────


After
─────
  F+ auth service        (single truth: principals, groups, ACL grants)
        │
        ▼  Custom F+ User Storage SPI
  Keycloak (federated view of F+; OIDC machinery unchanged)
        │
        ▼  JWT { sub, fp_principal_uuid, fp_groups[] }
  Grafana / acs-i3x / future consumers

  Kerberos KDC           (still truth for service-to-service + MQTT/SPN)
        │
        ▼  Used by SPI for credential validation only (SPNEGO)
```

### Elements

1. **F+ auth read-API extensions** so the SPI has a stable, paginated,
   search-friendly surface to call. The existing `/principal`,
   `/identity/:kind/:name`, and `/grant/find` endpoints get us most of the
   way; expect to add a paginated user list with prefix search (for
   Keycloak's user-search UX), a "groups containing principal" lookup, and a
   "members of group" lookup. Read-only. Authenticated as a service
   principal (sv1openid is already mounted on the Keycloak pod).

2. **The SPI plugin itself** (Java, packaged as a jar). Implements
   Keycloak's standard SPI interfaces:
   - `UserStorageProvider` (root)
   - `UserLookupProvider` and `UserQueryProvider` (find users by id, name,
     email, search string)
   - `GroupLookupProvider` (find groups, list group members)
   - `CredentialInputValidator` — delegates password/SPNEGO validation to
     the existing Kerberos infrastructure rather than storing or
     verifying credentials itself

   The plugin maps F+ principal UUID → Keycloak user id, F+ "name" attribute
   → username, F+ groups → Keycloak groups (flattened to effective
   membership). All operations are READ_ONLY.

3. **Custom JWT claim mappers** that stamp F+ data into tokens. At minimum:
   - `fp_principal_uuid` (string)
   - `fp_groups` (array of UUIDs)
   - `fp_classes` (array of class UUIDs the principal belongs to)

   These are first-class F+ identifiers. Consumers (Grafana role mapping,
   acs-i3x token exchange, future consumers) read these claims directly
   instead of inventing per-client conventions.

4. **A custom Keycloak container image** built in this repo's CI pipeline:
   `FROM quay.io/keycloak/keycloak:26.1.1` plus the SPI jar copied into
   `/opt/keycloak/providers/`. Pinned version. Replaces the upstream image
   reference in `deploy/values.yaml`.

5. **Helm and service-setup changes** to provision the `factoryplus`
   federation provider in place of `kerberos`, and to update the Grafana
   client's role mapping. The Grafana role mapper changes from "stamp
   per-client roles" to "stamp `fp_groups`", and `grafana-ini.yaml`'s
   `role_attribute_path` becomes `contains(fp_groups[*], '<viewer-uuid>')
   && 'Viewer' || ...`. Once that lands, granting Grafana access becomes a
   normal F+ ACL operation.

6. **Seed groups in service-setup** for the well-known Grafana roles
   (`Grafana Viewer`, `Grafana Editor`, `Grafana Admin`) so admins have
   something to grant against on day one. Defined as F+ groups with stable
   UUIDs in the existing dump-schema flow.

7. **A documented happy-path verification recipe**: provision a F+
   principal, add it to `Grafana Editor`, log in to Grafana, observe
   correct role. Same recipe with acs-i3x's per-consumer principal once
   that work lands.

### Flow: a user logs in to Grafana

```
Browser
  │  /grafana/login
  ▼
Grafana
  │  redirect → openid.host/realms/factory_plus/protocol/openid-connect/auth
  ▼
Keycloak
  │  (no local user) → ask federation provider chain
  ▼
F+ User Storage SPI
  │  GET acs-auth/identity/kerberos/<upn>
  │  GET acs-auth/principal/<uuid>/groups
  │  returns federated user with groups
  ▼
Keycloak
  │  authenticate via SPNEGO (delegated to Kerberos via existing keytab)
  │  build JWT, stamp fp_principal_uuid + fp_groups via custom mappers
  ▼
Grafana
  │  reads fp_groups, role_attribute_path → "Editor"
  │  session established with Grafana role driven by F+ ACL
```

### Flow: an admin grants Grafana access

```
F+ ACL editor
  │
  ├─► Find principal "alex.godbehere"
  │
  ├─► Add to group "Grafana Editor" (well-known UUID)
  │
  └─► Save
        │
        ▼
  Next Grafana login picks up new group via SPI lookup
  (cache TTL: 60s; no Keycloak admin round-trip needed)
```

## Rabbit Holes

These are the de-risking decisions. Each one removes a known way the team
could get stuck.

- **Java is the only language for the SPI.** Keycloak's SPI is JVM-only.
  The team is JS/TS-first, so the SPI gets kept deliberately small (~600
  LOC target), thoroughly unit-tested, and patterned on Keycloak's
  upstream Kerberos federation source. No business logic in the plugin
  beyond mapping; everything substantive stays in `acs-auth`.

- **Credential validation stays Kerberos.** The SPI does not store, verify,
  or have any opinion about passwords. It implements
  `CredentialInputValidator` only as a thin shim over the existing
  Kerberos SPNEGO path — same keytab, same KDC, same flow Keycloak uses
  today. This avoids inventing a new authentication path and avoids ever
  asking F+ to verify passwords.

- **Cache with a short TTL, do not invent invalidation.** SPI lookups use
  Keycloak's CACHED policy with a 60-second TTL. No webhook from F+ to
  Keycloak, no message bus, no cross-replica invalidation. If an admin
  grants a permission and the user does not see it for up to a minute,
  that is the documented behaviour. Re-evaluate if/when this becomes a
  real complaint.

- **Greenfield realm only.** When the federation source flips from
  `kerberos` to `factoryplus`, existing federated user records in the
  Keycloak DB will not migrate cleanly (federation links are by provider
  UUID). The path forward: `service-setup` tears down the existing realm
  and rebuilds with the new federation. This branch's prior work is not
  yet in production; nothing to migrate. Document explicitly that this is
  not an in-place upgrade.

- **Custom image, not initContainer jar mount.** The SPI ships baked into
  a custom image (`acs-keycloak`) versioned alongside ACS. Avoids the
  initContainer jar-copy dance, makes upgrades atomic, and matches how
  every other ACS component is built.

- **Keycloak version pin.** SPI ABI is stable inside a minor series but
  drifts across majors. Pin to 26.x. Major-version bumps are an explicit
  task that includes plugin compatibility verification.

- **Claim names are public API.** `fp_principal_uuid`, `fp_groups`,
  `fp_classes` are documented in the Factory+ spec docs and treated as
  stable. Renaming them later breaks every consumer.

- **Group membership is flattened in the JWT.** F+ groups are recursive;
  Keycloak groups can be too, but the SPI exposes effective (transitive)
  membership flattened. Consumers like Grafana cannot reason about the
  hierarchy and do not need to.

- **One Keycloak realm.** No multi-realm story. ACS is one tenant.

## No-Gos

- **Not replacing Kerberos for service-to-service auth.** All sv1*
  service principals, MQTT GSSAPI, and the krb-keys-operator workflow
  stay exactly as they are. This pitch only changes the source of
  *user-identity* data inside Keycloak.

- **Not building F+ as a native OIDC issuer.** Keycloak remains the OIDC
  provider. We do not write `/authorize`, `/token`, JWKS, browser login
  pages, or refresh-token rotation. That work was evaluated and rejected
  as a multi-month re-implementation of a hardened upstream.

- **Not migrating the Manager UI to OIDC** as part of this work. Once
  this lands it becomes much smaller and can be its own pitch.

- **No SAML or external IdP federation** (Azure AD, Google Workspace,
  etc.). Possible later because Keycloak supports it natively, but not
  in scope here.

- **No Keycloak HA story.** Keycloak stays single-replica with the
  Recreate strategy as it is today. SPI cache invalidation across
  replicas is not a problem we have.

- **No user self-service in Keycloak.** No password reset, no profile
  edit, no MFA enrollment. F+ has none of these concepts and adding them
  is a separate product question.

- **No write-back from Keycloak to F+.** SPI is READ_ONLY. Admins manage
  F+ data through the F+ ACL editor, full stop.

- **No OAuth scope-to-ACL bridging.** A JWT requesting `scope=read` does
  not narrow what F+ permits. F+ ACLs are the authorization model;
  scopes are ignored.

- **No reconciliation of existing Keycloak user records.** Greenfield
  realm only.
