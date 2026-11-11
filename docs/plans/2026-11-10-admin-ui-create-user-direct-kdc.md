# Create Users from the Admin UI — direct-to-KDC alternative

## Context

This is an alternative architecture to `docs/plans/2026-11-09-admin-ui-create-user.md`
(left unmodified), which routes principal creation through
`acs-krb-keys-operator` by submitting a `KerberosKey` CR. The underlying
problem and goal are unchanged: onboarding a human user today means three
manual, disconnected steps (create a Kerberos principal via `kadmin`,
create a ConfigDB object, wire up ACL/group membership), and the goal is a
single atomic "Create User" action in `acs-admin`.

Two problems with the CR-based shape prompted exploring this alternative:

- `acs-krb-keys-operator` **never raises `kopf.PermanentError`** — every
  failure (including ones that can never succeed, like a bad class UUID)
  is retried forever with backoff, and there's no `status.conditions`. The
  calling service can't distinguish "slow" from "will never finish", so
  it's forced into a bounded-poll-with-timeout dance and a "still
  provisioning" (202) UI state.
- The whole flow is inherently asynchronous/CR-mediated for what is, from
  the admin's point of view, a single synchronous action.

Here the new service talks to the KDC directly via kadmin, making user
creation a genuinely synchronous HTTP call. The explicit trade-off: this
*does* mean a second component now holds kadmin-capable Kerberos
credentials and the `python-kadmV` native build — the original plan's
"only one credential holder" property is deliberately given up in exchange
for removing the CR-polling complexity and the operator's retry-forever
footgun. The mitigations below (a dedicated, least-privilege KDC principal;
no Kubernetes RBAC at all) keep that trade-off as narrow as possible.

Two scope decisions made up front:
- The new service is **pure Python** (not a JS/Python hybrid, not a new
  Node kadm5 addon) — it reuses the existing `python-kadmV` C extension
  directly, the same way `acs-krb-keys-operator` does.
- The Factory+ HTTP client code currently embedded in
  `acs-krb-keys-operator/lib/amrc/factoryplus/service_client/` gets
  **extracted to a new shared `lib/py-service-client`**, mirroring the
  `lib/js-service-client` convention, and both `acs-krb-keys-operator` and
  the new service depend on it via a local path dependency.

## Components

### 1. New shared library: `lib/py-service-client`

Extract `acs-krb-keys-operator/lib/amrc/factoryplus/service_client/`
(`auth.py`, `configdb.py`, `directory.py`, `discovery.py`,
`edge_deployment.py`, `http.py`, `service_error.py`,
`service_interface.py`) into a new Poetry project, laid out like
`lib/py-edge-driver` (`src/amrc/factoryplus/service_client/...`,
`pyproject.toml`, `tests/`).

- `acs-krb-keys-operator`'s own `requirements.txt`/imports switch to depend
  on this package by local path, the same way it already depends on
  `/acs-lib/py-python-kadmv`. Verify the exact import style used today
  (`acs-krb-keys-operator/lib/amrc/factoryplus/krbkeys/__init__.py` and
  `account.py` import from `..service_client` or
  `amrc.factoryplus.service_client`) so the package layout after
  extraction keeps those imports working, and update
  `acs-krb-keys-operator/Dockerfile` accordingly.
- **New addition while extracting**: `auth.py` currently has no ACL-check
  support (the operator never needed it — it has no HTTP API of its own).
  Add `fetch_acl(type, principal)` / `check_acl(principal, permission,
  target, wild)` to the Python `Auth` class, mirroring
  `lib/js-service-client/lib/service/auth.js:136-157` exactly: `GET
  v2/acl/{type}/{principal}` (or `v2/acl/{uuid}` for `type == "uuid"`),
  returns a list of `{permission, target}`, then a local predicate checking
  `permission == perm and (target == target or (wild and target ==
  Null_UUID))`. Both consumers need this; the new `acs-user-admin` service
  needs it for the standard ACL-gate.
- `find_principal("kerberos", name)` already exists in the operator's
  `auth.py` (used by `event.py`'s `AccUuid` handler) — carries over
  unchanged, this is the pre-flight duplicate check.

### 2. New service: `acs-user-admin` (pure Python)

Structured like `acs-krb-keys-operator` (Poetry project, `src/amrc/...`
layout) but as an HTTP service instead of a kopf operator — there is no
existing Python equivalent of `@amrc-factoryplus/service-api` in this repo,
so the inbound-auth piece below is new, scoped locally to this service
(not extracted to a shared lib — there's only one consumer today; extract
later if a second Python HTTP service appears).

- **Framework**: Flask. kadmin calls via `python-kadmV` are blocking C
  calls anyway, so there's no benefit to an async framework here.
- **`lib/kadmin.py`**: adapt `Kadm` from
  `acs-krb-keys-operator/lib/amrc/factoryplus/krbkeys/kadmin.py` — it
  already has no kopf coupling (its only dependency is a trivial `log`
  import), so this is close to a straight copy. The one call needed:
  `Kadm.set_password(principal, password)` (`kadmin.py:89-92`) — internally
  calls `find_princ` (`kadmin.py:21-28`, creates the principal via
  `kadm.addprinc(princ, None)` if it doesn't exist) then
  `kpr.change_password(password)`. One call creates the principal *and*
  sets the password; no separate create-then-password-set dance needed.
- **`lib/auth.py`**: inbound HTTP auth, modeled on
  `lib/js-service-api/lib/auth.js`'s `FplusHttpAuth` (`auth.js:28-221`) —
  accept `Negotiate` (SPNEGO, via the `gssapi` PyPI package's
  `SecurityContext(usage="accept")`, the Python equivalent of
  `GSS.createServerContext`/`acceptSecContext`), issue an opaque Bearer
  token from `POST /token` (mirrors `auth.js:206-220`), and accept that
  token on subsequent calls. `gssapi` is a C extension too, but builds
  against the same `libkrb5-dev` headers already required for
  `python-kadmV` — no new system-level build dependency, just one more pip
  package.
- **Route**: `POST v1/user`, body `{ name, principal, password, groups:
  [uuid] }` — same contract as the original plan.
- **ACL check**: `fplus.auth.check_acl(caller, UserAdmin.Perm.ManageUsers,
  Special.Wildcard, False)` using the newly-added `check_acl` from
  `lib/py-service-client`. 403 on failure.
- **Pre-flight duplicate check**: `fplus.auth.find_principal("kerberos",
  principal)` — 409 if already mapped.
- **Core logic — fully synchronous, no polling**:
  1. `kadm.set_password(principal, password)` — creates the KDC principal
     and sets its password in one call.
  2. ConfigDB/Auth provisioning. `account.py`'s `reconcile_configdb`/
     `reconcile_auth` (`account.py:83-132`) is **not** the right precedent
     here — it reconciles an object that already exists (no
     `create_object` call anywhere in it; that happens elsewhere, in
     `event.py`'s `AccUuid` handler) and calls `add_identity` *last*, after
     the ConfigDB-side work. Since `acs-user-admin` is creating a brand-new
     object, the correct precedent is `do_acc` in
     `acs-cluster-manager/lib/actions.js:140-170`, which does exactly this
     "from scratch" sequence via the shared client:
     - `uuid = configdb.create_object(Auth.Class.HumanUser)`
     - `configdb.put_config(App.Info, uuid, { "name": name })`
     - for each group UUID in `groups`: `configdb.class_add_member(group,
       uuid)`
     - `auth.add_identity(uuid, "kerberos", principal)`
  3. Return `201 { uuid }` synchronously. No 202/"still provisioning" case
     — this is the main simplification direct-KDC calls buy over the CR
     approach.
  - If step 2 fails partway after step 1 succeeded, there is no automatic
    rollback of the KDC principal — return 500 with the principal name
    logged for manual follow-up. This mirrors an already-accepted rough
    edge elsewhere in the codebase (`Auth.create_principal`'s own `XXX`
    comment at `lib/js-service-client/lib/service/auth.js:394-395` about
    the same class of partial-failure cleanup gap), not a new risk class.
- **Secret handling**: the password lives only in the authenticated
  request body and process memory for the duration of the call — it is
  never written to a Kubernetes Secret or disk at all. This is a genuine
  improvement over the CR-based plan, which required briefly persisting
  the password into a one-off cluster Secret for the operator to read
  asynchronously.

### 3. New Kerberos identity for the service + KDC ACL scoping

- `deploy/templates/user-admin/krbkeys.yaml` — a `KerberosKey` CR (this
  remains the right mechanism for *central-service* identities; the
  operator's role doesn't change for anything except human users),
  `type: Random`, `account.class: Auth.Class.CentralService`, producing a
  keytab with both `client` and `server` entries, modeled directly on
  `deploy/templates/cluster-manager/krbkeys.yaml`.
- New dedicated principal (e.g. `op1useradmin`), **not** a reuse of
  `op1krbkeys`'s identity, so the credential capable of creating KDC
  principals is independently scoped, auditable, and revocable. Add a new
  ACL line for it in the KDC's ACL file (`deploy/templates/identity/
  kdc.yaml`'s `kdc-conf` ConfigMap, alongside the existing `op1krbkeys`
  rule), granting **only `ac`** (add principal, change password) — not
  `op1krbkeys`'s full `x` (all) — so a compromise of this credential can't
  delete or modify existing principals, only create new ones and set their
  passwords. This ACL line is the main security-sensitive piece of this
  plan and should get explicit review.

### 4. Factory+ bootstrap (`acs-service-setup`)

Unchanged in shape from the original plan:
- `ACS.Service.UserAdmin`, `UserAdmin.Perm.ManageUsers` in
  `acs-service-setup/lib/uuids.js`.
- New `dumps/user-admin.yaml` (modeled on `dumps/i3x.yaml`): register the
  `Service` member (mirrors `dumps/core-service.yaml:21-44`), register the
  permission under a new `PermGroup` (mirrors `dumps/acs-v2.yaml:27-33`),
  grant it to `ACS.Group.Administrator`.
- Directory URL registration in `deploy/templates/service-setup.yaml`
  (mirrors the `clusterManager.enabled` block).
- No extra bootstrap needed for `op1useradmin`'s ConfigDB/Auth-side
  permissions beyond what's already proven for `op1krbkeys` in
  `acs-service-setup/dumps/service-accounts.yaml:132-150` (`ConfigDB.Perm.
  CreateObject`/`CreateSpecificObject` over `PrincipalType`, `Auth.Perm.
  ManageKerberos`) — grant the same set to `op1useradmin`.

### 5. Helm deploy (`deploy/templates/user-admin/`)

- `Deployment` with **three containers**, mirroring
  `deploy/templates/identity/krb-keys-operator.yaml`'s shape exactly: the
  app container (Flask process; `KRB5CCNAME`/`KADMIN_CCNAME` env vars;
  mounts the `server` keytab entry too, for its own inbound SPNEGO), plus
  `tgt-creds` and `kadmin-creds` `k5start` sidecars sharing a `krb5-ccache`
  `emptyDir` mounted at `/ccache` — each sidecar writes its own ccache file
  within it (`/ccache/krbkeys`, `/ccache/kadmin`), the same two ticket
  flavors the operator needs (a plain TGT for outbound Factory+ calls, a
  `kadmin/admin` service ticket for the kadm5 protocol).
- `wait-for-kdc` initContainer (`_helpers.tpl:160-180`), reused as-is.
- **No ClusterRole/RBAC at all.** Confirmed repo convention: no
  long-running central service has Kubernetes RBAC today except
  `krb-keys-operator` and `kubegres` (two Helm-hook Jobs — `service-setup`
  and `post-delete` — also define their own RBAC, but those are one-shot
  install/uninstall jobs, not services); every other central service
  (including this one) only needs a keytab Secret mounted as a volume, no
  K8s API access. This is a real simplification versus the CR-based plan,
  which needed `create/get/watch` on `kerberos-keys` CRs plus
  Secret-management RBAC.
- `Service` for the HTTP API; `values.yaml` entries (`userAdmin.enabled`,
  image, resources).

### 6. Service-client library (`lib/js-service-client`)

Unchanged from the original plan: `UUIDs.Service.UserAdmin` constant, new
`lib/service/user-admin.js` (`UserAdmin extends ServiceInterface`,
`create_user({name, principal, password, groups})` → `POST v1/user`),
registered in `lib/interfaces.js`/`service-client.js`, exposed as
`client.UserAdmin`.

### 7. Admin UI (`acs-admin`)

Same as the original plan (`CreateUserDialog.vue` next to
`LinkUserDialog.vue`, `ObjectSelector` for groups, `useVuelidate()`,
submitting spinner), with one simplification: since the backend call is
now fully synchronous, there's no "still provisioning" (202) branch to
handle in the UI — just success/error toasts. A loading spinner is still
worth keeping (`submitting` ref pattern from `NewDeviceDialog.vue`) since
the round-trip (kadmin + several ConfigDB/Auth calls) is a real, if
bounded, few-second operation.

## Deliverable phases

Grouped by dependency order, each ending at a reviewable, independently
mergeable checkpoint.

### Phase 1 — Backend foundation (no deploy)

Components 1 and 2. Checkpoint: service runs locally against a test KDC,
unit tests pass (verification items 1–2). Not yet reachable from a real
cluster.

1. **Extract `lib/py-service-client`**: new Poetry project laid out like
   `lib/py-edge-driver`; move `auth.py`, `configdb.py`, `directory.py`,
   `discovery.py`, `edge_deployment.py`, `http.py`, `service_error.py`,
   `service_interface.py` out of
   `acs-krb-keys-operator/lib/amrc/factoryplus/service_client/` unchanged.
2. **Repoint `acs-krb-keys-operator`**: switch its
   `requirements.txt`/`pyproject.toml` and imports to the extracted
   package (local path dependency, same pattern as its existing
   `py-python-kadmv` dependency); update its `Dockerfile`; confirm its
   existing test suite (if any) still passes.
3. **Add `fetch_acl`/`check_acl` to the Python `Auth` class** in the new
   lib, mirroring `lib/js-service-client/lib/service/auth.js` exactly
   (`check_acl` at lines 91-94, `fetch_acl` at lines 136-157); add a unit
   test for both.
4. **Scaffold `acs-user-admin`**: new Poetry project, `src/amrc/...`
   layout, Flask app skeleton, depends on `lib/py-service-client` by local
   path.
5. **Port `lib/kadmin.py`**: adapt `Kadm` from
   `acs-krb-keys-operator/lib/amrc/factoryplus/krbkeys/kadmin.py` —
   near-verbatim copy, confirm `set_password` behaviour (creates principal
   if absent, then sets password) against a local-KDC test harness.
6. **Implement inbound auth (`lib/auth.py`)**: SPNEGO accept via `gssapi`
   (`SecurityContext(usage="accept")`), `POST /token` issuing an opaque
   Bearer token, Bearer validation on subsequent calls — modeled on
   `lib/js-service-api/lib/auth.js`'s `FplusHttpAuth`.
7. **Implement `POST v1/user`**: ACL check
   (`UserAdmin.Perm.ManageUsers`), pre-flight duplicate-principal check
   (`find_principal`), `kadm.set_password`, then the ConfigDB/Auth
   provisioning chain modeled on `do_acc` in
   `acs-cluster-manager/lib/actions.js:140-170` (`create_object`,
   `put_config(App.Info, ...)`, `class_add_member` per group,
   `add_identity` last), `201 {uuid}` on success, no rollback of the KDC
   principal on partial failure (logged 500).
8. **Unit tests**: ACL-check-fails path, duplicate-principal path,
   `Kadm.set_password` against the `lib/py-python-kadmv/test/kldap/`
   harness.

### Phase 2 — Cluster wiring

Components 3, 4, 5. Checkpoint: `acs-user-admin` deployed to a dev
cluster, authenticates inbound SPNEGO, and `v1/user` can be called
directly with a test Kerberos ticket to create a real principal
(verification items 3–4).

1. **New service identity**: `deploy/templates/user-admin/krbkeys.yaml`,
   a `KerberosKey` CR (`type: Random`, `account.class:
   Auth.Class.CentralService`), modeled on
   `deploy/templates/cluster-manager/krbkeys.yaml`, producing a keytab
   with `client` and `server` entries for a new `op1useradmin` principal.
9. **KDC ACL scoping**: add an ACL line for `op1useradmin` in
   `deploy/templates/identity/kdc.yaml`'s `kdc-conf` ConfigMap, granting
   only `ac` (add principal, change password) — not `op1krbkeys`'s full
   `x`.
10. **Factory+ bootstrap constants**: `ACS.Service.UserAdmin`,
    `UserAdmin.Perm.ManageUsers` in `acs-service-setup/lib/uuids.js`.
11. **`dumps/user-admin.yaml`**: register the `Service` member (mirrors
    `dumps/core-service.yaml:21-44`), register the permission under a new
    `PermGroup` (mirrors `dumps/acs-v2.yaml:27-33`), grant it to
    `ACS.Group.Administrator`.
12. **Grant `op1useradmin` ConfigDB/Auth permissions**: same set already
    proven for `op1krbkeys` in
    `acs-service-setup/dumps/service-accounts.yaml:132-150`
    (`ConfigDB.Perm.CreateObject`/`CreateSpecificObject` over
    `PrincipalType`, `Auth.Perm.ManageKerberos`).
13. **Directory URL registration**: `deploy/templates/service-setup.yaml`,
    mirroring the `clusterManager.enabled` block.
14. **Helm Deployment/Service**: `deploy/templates/user-admin/*.yaml`,
    three containers (app + `tgt-creds` + `kadmin-creds` `k5start`
    sidecars sharing a `krb5-ccache` `emptyDir` mounted at `/ccache`),
    `wait-for-kdc` initContainer reused as-is, no RBAC, `values.yaml`
    entries (`userAdmin.enabled`/image/resources).
15. **Deploy and verify**: confirm inbound SPNEGO auth works, call
    `v1/user` directly with a test ticket, confirm the principal appears
    in `kadmin.local listprincs` and the ConfigDB object appears via
    `client.Auth.list_principals()`, confirm 409 on a repeat call, and
    confirm `op1useradmin`'s restricted ACL can't touch an unrelated
    existing principal.

### Phase 3 — Client + UI

Components 6, 7. Checkpoint: full end-to-end "Create User" flow works
from the Admin UI (verification item 5).

16. **`lib/js-service-client`**: `UUIDs.Service.UserAdmin` constant, new
    `lib/service/user-admin.js` (`UserAdmin extends ServiceInterface`,
    `create_user({name, principal, password, groups})` → `POST v1/user`),
    registered in `lib/interfaces.js`/`service-client.js`, exposed as
    `client.UserAdmin`.
17. **`CreateUserDialog.vue`**: next to `LinkUserDialog.vue`, form fields
    for name/principal/password, `ObjectSelector` for groups,
    `useVuelidate()` validation, `submitting` spinner (pattern from
    `NewDeviceDialog.vue`), success/error toasts (no 202 branch needed —
    the call is synchronous).
18. **Wire into `AccessControl.vue`**: trigger button alongside the
    existing link-user action.
19. **UI walkthrough**: dev server, log in as Administrator, Access
    Control → Principals → Create User, submit, confirm success toast and
    immediate appearance in the Principals list, confirm the
    duplicate-principal case shows a clear, immediate error.

## Verification

1. **`lib/py-service-client` extraction**: `acs-krb-keys-operator`'s
   existing test suite (if any) still passes after the import-path switch;
   add a unit test for the new `check_acl`/`fetch_acl` methods.
2. **`acs-user-admin` unit tests**: ACL-check-fails path, pre-flight
   duplicate-principal path, the `Kadm.set_password` call (can likely be
   tested against the same local-KDC test harness `lib/py-python-kadmv/
   test/kldap/` already sets up, rather than inventing a new one).
3. **End-to-end, against a dev cluster** with `acs-identity` and the new
   service deployed: call `v1/user` directly with a Kerberos ticket for a
   test user, then confirm independently: `kadmin.local listprincs` shows
   the new principal; `client.Auth.list_principals()` / the Principals tab
   shows the new UUID; the user can authenticate against the KDC with the
   chosen password; attempting the same principal again returns 409
   immediately (no retry-forever).
4. **KDC ACL scoping check**: confirm `op1useradmin`'s kadmin credentials
   cannot delete or modify an unrelated existing principal (only add/change
   password), verifying the restricted ACL line actually took effect.
5. **UI walkthrough**: run `acs-admin` dev server, log in as an
   Administrator, Access Control → Principals → Create User, submit, confirm
   the success toast and immediate appearance in the Principals list, and
   confirm the duplicate-principal case shows a clear, immediate error.

## Files of note

- New: `lib/py-service-client/` (extracted from
  `acs-krb-keys-operator/lib/amrc/factoryplus/service_client/`)
- Edit: `acs-krb-keys-operator/requirements.txt` (or `pyproject.toml`),
  `acs-krb-keys-operator/Dockerfile`, and its import statements to use the
  extracted package.
- New: `acs-user-admin/{pyproject.toml,src/.../app.py,src/.../lib/{auth.py,kadmin.py,routes.py}}`
- New: `deploy/templates/user-admin/*.yaml` (Deployment/Service/krbkeys,
  no RBAC)
- Edit: `deploy/templates/identity/kdc.yaml` (new `op1useradmin` ACL line)
- New: `acs-service-setup/dumps/user-admin.yaml`; edit:
  `acs-service-setup/lib/uuids.js`,
  `acs-service-setup/dumps/service-accounts.yaml`,
  `deploy/templates/service-setup.yaml`
- New: `lib/js-service-client/lib/service/user-admin.js`; edit:
  `lib/js-service-client/lib/uuids.js`, `lib/interfaces.js`,
  `lib/service-client.js`
- New: `acs-admin/src/pages/AccessControl/Principals/CreateUserDialog.vue`;
  edit: `acs-admin/src/pages/AccessControl/AccessControl.vue`
- Reference-only (not modified):
  `acs-krb-keys-operator/lib/amrc/factoryplus/krbkeys/{account.py,kadmin.py,event.py}`,
  `acs-cluster-manager/lib/actions.js` (`do_acc`, ConfigDB/Auth-provisioning
  precedent), `lib/js-service-api/lib/auth.js` (inbound-auth model),
  `acs-admin/src/pages/AccessControl/LinkUserDialog.vue`.
