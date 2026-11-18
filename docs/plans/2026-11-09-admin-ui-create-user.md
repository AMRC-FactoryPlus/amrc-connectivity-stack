# Create Users from the Admin UI

## Context

Today, onboarding a new human user to Factory+ means: (1) manually running
`kadmin` against the KDC to create a Kerberos principal, then (2) manually
creating a ConfigDB object for them, linking it to that principal, and
adding ACL/group membership — three disconnected manual steps, each one
done by hand per user. This is slow for onboarding multiple users and
error-prone (easy to forget a step). The goal is a single "Create User"
action in `acs-admin` that does all three atomically.

### Why this shape, not a simpler one

Only one thing in this codebase should ever hold Kerberos admin (`kadmin`)
credentials: `acs-krb-keys-operator`. It already has the keytab, the GSSAPI
bootstrap dance, and the only `python-kadmv` (kadm5 C-extension) build in
the repo. It already supports, via a `KerberosKey` CR's `account` sub-spec,
doing the KDC principal creation *and* the ConfigDB/Auth-side provisioning
(object creation, `Info` name, group membership, identity mapping) in one
reconcile (`acs-krb-keys-operator/lib/amrc/factoryplus/krbkeys/account.py`).

So rather than teaching a new service to speak kadmin directly (duplicate
credential-holder, duplicate native build, bigger attack surface), the new
backend's only job is to **authenticate/ACL-check the request and submit a
`KerberosKey` CR**, then wait briefly for the operator to finish, so the
admin UI gets a synchronous-feeling response. This mirrors the one
runtime precedent for a service creating these CRs,
`acs-cluster-manager/lib/krbkeys.js` — though note that code is dead/unused
and has no RBAC backing it today, so it's a style reference, not something
being wired in.

`acs-admin` itself is a pure browser SPA with no backend of its own, so it
cannot create Kubernetes objects directly — hence the need for a small new
service at all.

## Components

### 1. New service: `acs-user-admin`

New top-level directory, canonical JS service shape (`bin/api.js` +
`lib/`, per CLAUDE.md), using `@amrc-factoryplus/service-client` and
`@amrc-factoryplus/service-api` like every other core service.

- **Route**: `POST v1/user` with body `{ name, principal, password, groups: [uuid] }`.
  - `principal` is the full Kerberos UPN (`jbloggs@REALM`), matching the
    existing `LinkUserDialog.vue` convention of taking a full UPN string.
  - `groups` are ConfigDB class UUIDs to add as initial membership (e.g.
    an `Administrator` role).
- **ACL check**: `fplus.Auth.check_acl(caller, Perm.ManageUsers, Special.Wildcard, false)`,
  following the `check_acl`/`fetch_acl` pattern from `acs-configdb/lib/auth.js`.
  Throw `APIError` (403) on failure, per CLAUDE.md conventions — no hand-rolled
  responses.
- **Pre-flight uniqueness check**: before touching Kubernetes, call
  `fplus.Auth.resolve_identity("kerberos", principal)`-equivalent (or the
  `GET v2/identity/kerberos/:name` route) to confirm the UPN isn't already
  mapped. Reject with 409 immediately if it is. This matters because of a
  real gap in the operator (next bullet) — without this check, a
  duplicate-principal request would spin the operator into an infinite
  retry loop with no way to observe failure.
- **Known operator limitation to design around**: `acs-krb-keys-operator`
  never raises a `kopf.PermanentError` — every exception (bad class UUID,
  DB conflict, KDC unreachable) is treated as temporary and retried forever
  with backoff. There is also no structured `status.conditions`; success is
  only inferable from the presence of `status.rekey` / `status.account_uuid`
  / `status.reconcile_account` keys with no matching entry left in
  `status.kopf.progress`. So the service's CR-status watch must be a
  **bounded poll with a timeout** (recommend ~20s, polling every 1-2s via
  the K8s watch or just repeated GETs) — on success within the timeout,
  return 201 with the resulting principal UUID (read from the CR's
  `factoryplus.app.amrc.co.uk/account-uuid` annotation); on timeout, return
  a distinct "still provisioning" response (e.g. 202) rather than a hard
  failure, since we cannot distinguish "slow" from "will never finish."
- **Secret handling**: generate a sanitized, collision-resistant CR/secret
  name from the principal (lowercase, non-alphanumerics replaced with `-`,
  short random suffix — don't reuse `manifests.js`'s naive
  `principal.replace(/@.*/, "")` as-is since it can collide). Write the
  admin-chosen password into a new one-off Secret (key `password`), create
  the `KerberosKey` CR with `type: PresetPassword`, `secret: <name>/password`,
  `account: { class: Auth.Class.HumanUser, name, groups }` (no `uuid` —
  let `AccUuid`'s handler create the ConfigDB object). On confirmed success,
  delete the one-off Secret (minimize how long the plaintext password sits
  in the cluster). On timeout, leave it for the operator's retries /
  eventual manual cleanup — same tradeoff the codebase already accepts for
  keytab Secrets, not a new category of risk.
- **K8s client**: `@kubernetes/client-node`'s `CustomObjectsApi`
  (`createNamespacedCustomObject`/`getNamespacedCustomObjectStatus`), same
  library and in-cluster-config pattern as `acs-cluster-manager/lib/krbkeys.js`.
  Group/version/plural constants (`factoryplus.app.amrc.co.uk/v1`,
  `kerberos-keys`) copied from `acs-cluster-manager/lib/manifests.js:16-21`.

### 2. Factory+ bootstrap (`acs-service-setup`)

- New UUID constants in `acs-service-setup/lib/uuids.js`: a `Service`
  entry (`ACS.Service.UserAdmin`) and a permission
  (`UserAdmin.Perm.ManageUsers`), following the existing
  `Auth.Perm.*`/`ACS.Service.*` patterns already in that file.
- New dump entries (new `dumps/user-admin.yaml`, modeled on
  `dumps/i3x.yaml`): register the `Service` class member (mirrors
  `dumps/core-service.yaml:21-44`), register the `ManageUsers` permission
  under a new `PermGroup` (mirrors `dumps/acs-v2.yaml:27-33`), and grant it
  to the existing `Administrator` role group so current admins can use the
  feature immediately (mirrors the ACE-granting pattern in
  `dumps/clusters.yaml`/`dumps/i3x.yaml`).
- New Helm-gated block in `deploy/templates/service-setup.yaml`'s
  `service-urls.yaml` ConfigMap (mirrors the `clusterManager.enabled`
  block at lines 234-236) so the Directory advertises the new service's URL.
- **No extra ConfigDB/Auth permission bootstrap needed for the operator's
  own service account** (`op1krbkeys`) — it already holds
  `ConfigDB.Perm.CreateObject` over `Auth.Class.PrincipalType` (which
  `HumanUser` subclasses) and `Auth.Perm.ManageKerberos`, confirmed in
  `acs-service-setup/dumps/service-accounts.yaml`.

### 3. Helm deploy templates (`deploy/templates/user-admin/`)

New directory, modeled on `deploy/templates/cluster-manager/` plus RBAC
that cluster-manager itself lacks:
- `Deployment` + `Service`, with a `k5start` sidecar mounting its own
  keytab (same shape as `deploy/templates/cluster-manager/clusters.yaml`).
- `ServiceAccount` + namespaced `Role` + `RoleBinding`: `create/get/watch`
  on `kerberos-keys`, `get/watch` on `kerberos-keys/status`, `create` on
  Secrets — mirrors the rule shape in the operator's own ClusterRole
  (`deploy/templates/identity/rbac.yaml:12-19`) but namespace-scoped.
- `krbkeys.yaml`: the service's own identity, `type: Random`,
  `account.class: Auth.Class.CentralService`, modeled directly on
  `deploy/templates/cluster-manager/krbkeys.yaml`.
- New `values.yaml` entries (`userAdmin.enabled`, image, resources).

### 4. Service-client library (`lib/js-service-client`)

- `UUIDs.Service.UserAdmin` constant in `lib/uuids.js`, alongside the
  existing `Service` block (lines 89-105).
- New `lib/service/user-admin.js`, modeled on the minimal `CmdEsc` class
  (`lib/service/cmdesc.js`): a `UserAdmin extends ServiceInterface` with
  one method, `create_user({ name, principal, password, groups })`,
  `POST`ing to `v1/user` and returning the parsed response (or throwing via
  `this.throw(...)` on non-2xx, matching `Auth.add_grant`'s shape).
- Register it in `lib/interfaces.js` and `ServiceClient.define_interfaces`
  (`lib/service-client.js:143-155`), exposing it as `client.UserAdmin`.

### 5. Admin UI (`acs-admin`)

- New `src/pages/AccessControl/Principals/CreateUserDialog.vue`, placed
  alongside `LinkUserDialog.vue` and triggered from the same toolbar
  (`AccessControl.vue`/`PrincipalList.vue`), next to the existing
  "Link User" button.
- Structure: Options API + `useVuelidate()`, following `LinkUserDialog.vue`'s
  shape, but with the `submitting` ref + spinner + richer
  `toast.error(msg, { description })` pattern from `NewDeviceDialog.vue`
  (this call can take ~20s on the backend, so a loading state matters).
- Fields: display name, Kerberos principal (full UPN, free text, matching
  `LinkUserDialog.vue`'s existing convention), password + confirm
  (vuelidate `required` + a `sameAs` check), and initial group membership
  via the reusable `ObjectSelector` multi-select component, exactly as used
  in `GroupsTab.vue:22-35` (`v-model` bound, sourced from `useGroupStore()`).
- On submit: `await s.client.UserAdmin.create_user({ name, principal, password, groups })`,
  then the standard refresh sequence already used after `add_principal`/
  `delete_principal` calls: `s.client.Fetch.cache = "reload"` →
  `await usePrincipalStore().fetch()` → `s.client.Fetch.cache = "default"`.
  If the backend returns the "still provisioning" (202) case, toast a
  neutral "still in progress, check back shortly" message rather than an
  error.
- No new UI-level permission gating: the repo's established convention
  (`I3xAccessDialog.vue`, `ShareCard.vue`) is "show the action, let the
  backend 403 and toast it" — follow that rather than building a new
  generic permission-check composable.

## Verification

1. **Service unit tests**: for `acs-user-admin`'s route handler, cover the
   ACL-check-fails path, the pre-flight-duplicate path, and the CR-name
   sanitization helper — follow whatever test setup the closest existing
   plain-JS core service uses (check `acs-configdb`/`acs-auth` for an
   existing lightweight test harness before introducing a new one).
2. **End-to-end, against a dev cluster** with `acs-identity` and
   `acs-krb-keys-operator` already deployed: call the new service's
   `v1/user` endpoint directly (with a Kerberos ticket) for a test user,
   then confirm independently: `kadmin.local listprincs` shows the new
   principal; `client.Auth.list_principals()` / the Principals tab shows
   the new UUID; the user can authenticate against the KDC with the chosen
   password.
3. **UI walkthrough**: run `acs-admin` dev server, log in as an
   Administrator, go to Access Control → Principals → Create User, submit
   the form, confirm the success toast, confirm the new user appears in
   the Principals list without a manual page refresh, and confirm the
   duplicate-principal case shows a clear error instead of hanging.

## Files of note

- New: `acs-user-admin/bin/api.js`, `acs-user-admin/lib/api.js`,
  `acs-user-admin/lib/krbkeys.js`
- New: `deploy/templates/user-admin/*.yaml`
- New: `acs-service-setup/dumps/user-admin.yaml`;
  edit: `acs-service-setup/lib/uuids.js`,
  `deploy/templates/service-setup.yaml`
- New: `lib/js-service-client/lib/service/user-admin.js`;
  edit: `lib/js-service-client/lib/uuids.js`, `lib/interfaces.js`,
  `lib/service-client.js`
- New: `acs-admin/src/pages/AccessControl/Principals/CreateUserDialog.vue`;
  edit: `acs-admin/src/pages/AccessControl/AccessControl.vue` (or
  `Principals/PrincipalList.vue`, whichever owns the toolbar)
- Reference-only (not modified): `acs-krb-keys-operator/lib/amrc/factoryplus/krbkeys/account.py`,
  `acs-cluster-manager/lib/krbkeys.js`, `acs-admin/src/pages/AccessControl/LinkUserDialog.vue`,
  `acs-admin/src/components/EdgeManager/Devices/NewDeviceDialog.vue`,
  `acs-admin/src/pages/AccessControl/Principals/GroupsTab.vue`
