# Connecting OAuth applications to ACS

ACS ships an OpenID Connect (OIDC) provider so that applications can
sign users in against Factory+. The provider is Keycloak (deployed as
the `openid` service), federated to the Factory+ auth service via a
custom User Storage SPI. Every JWT issued for an ACS-provisioned
client carries Factory+ identity claims, so applications can drive
their authorization decisions directly from F+ ACL grants.

This document shows how to add a new OAuth/OIDC client to an ACS
deployment. Grafana is the reference example - everything described
here is exactly what `serviceSetup.config.openidClients.grafana` does
under the hood. The same pattern works for any application that
speaks OIDC.

> **Audience:** operators who want to connect a new web app, API, or
> internal tool to ACS authentication. Not edge agents - those still
> use Kerberos/Sparkplug.

## How OIDC fits into ACS

```
                ┌───────────────────────────────┐
                │      Factory+ auth service    │
                │  (principals, groups, ACLs)   │
                └──────────────┬────────────────┘
                               │  HTTP, sv1openid keytab
                               ▼
                ┌───────────────────────────────┐
                │  Keycloak (openid service)    │
                │   + acs-keycloak-spi plugin   │
                │      issues JWTs with         │
                │   fp_principal_uuid           │
                │   fp_permissions[]            │
                └──────────────┬────────────────┘
                               │  OIDC (auth code + PKCE)
                               ▼
                ┌───────────────────────────────┐
                │       Your application        │
                │  (Grafana, internal tool, …)  │
                └───────────────────────────────┘
```

Two pieces of the JWT matter to a client application:

| Claim | Type | Meaning |
|-------|------|---------|
| `fp_principal_uuid` | string | The user's Factory+ principal UUID. Use this if you need to call other F+ services with the user's identity, or to look up F+ data about the user. |
| `fp_permissions` | string[] | UUIDs of the F+ Permission objects the user has been granted with `target=Wildcard`. This is the F+-native input to your role/permission mapping. |
| `preferred_username` | string | The user's Kerberos UPN (e.g. `alice@FACTORYPLUS.MYORG.COM`). Use this for display or as a fallback "email" - F+ has no email field. |
| `sub` | string | Keycloak's stable user id. Equal to `fp_principal_uuid` for federated users. |

The two `fp_*` claims appear in the access token, ID token, userinfo
response, and introspection response. They are stamped only on tokens
issued for users sourced from the Factory+ federation; they are
omitted from tokens for any local Keycloak user (e.g. the bootstrap
admin).

## What service-setup creates for you

Listing a client under `serviceSetup.config.openidClients` is enough
to get a fully working confidential OIDC client. On every Helm
install/upgrade, ACS will:

1. Generate a random client secret via a `LocalSecret` resource and
   store it in the `keycloak-clients` Kubernetes Secret under a key
   matching the client name.
2. Create or update the client in Keycloak with:
   - `clientId` = the entry name
   - confidential client (`publicClient: false`), `standardFlowEnabled` (auth code)
   - rootUrl/baseUrl/webOrigins = `<proto>://<name>.<acs.baseUrl>` (overridable - see *Keys* below)
   - `redirectUris` = `<root><spec.redirectPath>` (defaults to `/*`; overridable)
   - `post.logout.redirect.uris` = `<root>` (overridable)
   - `backchannel.logout.session.required = true` (force-logouts in
     Keycloak invalidate the application's session immediately)
3. Attach the `fp_principal_uuid` and `fp_permissions` protocol
   mappers to the client.

Operations that the ACS deployment owns - and that you should not
duplicate elsewhere:

- Realm setup (`factory_plus` by default)
- The Factory+ User Storage federation provider
- TLS termination (Traefik with the cluster wildcard certificate)
- Disabling Keycloak's `UPDATE_PROFILE`/`VERIFY_PROFILE`/`VERIFY_EMAIL`
  required actions (F+ has no profile fields, the SPI is read-only)

## Step by step: adding a new client

The example below adds a client called `myapp` that is served at
`https://myapp.<acs.baseUrl>` with an OAuth callback at
`/oauth2/callback`.

### 1. Declare the client in `values.yaml`

```yaml
serviceSetup:
  config:
    openidClients:
      myapp:
        enabled: true
        name: My Application       # human-readable name shown in Keycloak UI
        redirectPath: /oauth2/callback
```

Keys:

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `enabled` | yes | - | Set `false` to skip provisioning without removing the entry. |
| `name` | no | the map key | Display name in the Keycloak admin UI. |
| `redirectPath` | no | `/*` | The path part of the redirect URI. Combined with `<proto>://<name>.<acs.baseUrl>`. Ignored if `redirectUris` is set. |
| `builtin` | no | `false` | If `true`, do not create or modify the client - just attach the `fp_*` claim mappers to a client that already exists in the realm. Useful for `admin-cli` and similar realm-builtin clients. |
| `rootUrl` | no | `<proto>://<name>.<acs.baseUrl>` | Override the client's Root URL (shown in the Keycloak admin UI; used by Keycloak to resolve relative URLs). |
| `baseUrl` | no | same as `rootUrl` | Override the client's Home URL (where Keycloak sends the user from the account console). |
| `redirectUris` | no | `[<root><redirectPath>]` | Override the full list of valid redirect URIs. Each entry is a full URL (or a Keycloak wildcard like `https://example.com/*`). When set, `redirectPath` is ignored. |
| `webOrigins` | no | `[<root>]` | Override the CORS web origins. Each entry is an origin (`https://host[:port]`). |
| `postLogoutRedirectUris` | no | `[<root>]` | Override the list of allowed post-logout redirect URIs. Each entry is a full URL. |

> **Override behaviour.** When any of the override fields above is
> set, the value flows straight through to Keycloak and **replaces**
> the auto-derived default for that field. This means removals work
> too - declaring `redirectUris: ["https://other.host/callback"]`
> will drop the canonical `https://<name>.<acs.baseUrl>/*` entry on
> the next service-setup run. Helm upgrades stay idempotent: leave
> the field unset and the existing default is preserved.

### 2. Apply the chart

```bash
helm upgrade --install acs ./deploy --values your-values.yaml
```

Watch the `service-setup` job:

```bash
kubectl logs -n <namespace> job/service-setup-<id> -c service-setup -f
```

You should see lines like:

```
[setup] Configuring OpenID realm
[openid] Keycloak is ready
[openid] Updating realm factory_plus
[openid] Creating client myapp
[openid] Creating fp_principal_uuid mapper on client <uuid>
[openid] Creating fp_permissions mapper on client <uuid>
[openid] OpenID setup complete
```

### 3. Find the client secret

The auto-generated secret lives in the `keycloak-clients` Secret
under the key matching the client name:

```bash
kubectl get secret keycloak-clients -n <namespace> \
  -o jsonpath='{.data.myapp}' | base64 -d
```

Mount it into your application instead of copy-pasting. For example:

```yaml
# in your application's Pod spec
volumes:
  - name: oauth-secret
    secret:
      secretName: keycloak-clients
      items:
        - key: myapp
          path: client_secret
volumeMounts:
  - name: oauth-secret
    mountPath: /etc/oauth
    readOnly: true
```

The application then reads `/etc/oauth/client_secret`. This is the
same pattern Grafana uses (see `grafana.extraSecretMounts` in
`deploy/values.yaml`).

### 4. Configure the application

Point the application at the OIDC endpoints below. URL placeholders:

- `<openid>` = `https://openid.<acs.baseUrl>` (or `http://...` if
  `acs.secure` is `false`)
- `<realm>` = `<openid>/realms/<openid.realm>` (default realm:
  `factory_plus`)
- `<root>` = `<proto>://<name>.<acs.baseUrl>`

| Endpoint | URL |
|----------|-----|
| Issuer / discovery | `<realm>/.well-known/openid-configuration` |
| Authorization | `<realm>/protocol/openid-connect/auth` |
| Token | `<realm>/protocol/openid-connect/token` |
| UserInfo | `<realm>/protocol/openid-connect/userinfo` |
| Logout | `<realm>/protocol/openid-connect/logout?post_logout_redirect_uri=<root>&client_id=<name>` |
| JWKS | `<realm>/protocol/openid-connect/certs` |

Most modern OIDC libraries can discover everything from the issuer
URL alone - prefer that over hard-coding individual endpoints.

### 5. Drive authorization from Factory+

This is the part that makes ACS-backed OIDC pay off. There are two
ways to make authorization decisions; pick whichever fits your app.

#### Option A - read `fp_permissions` straight from the JWT

Use this when your application has a small number of named roles and
you want admins to manage them via the F+ ACL editor.

1. Pick a stable UUID for each role/capability your application has
   (e.g. `myapp.admin`, `myapp.editor`). Generate fresh UUIDs - do
   not reuse Grafana's or any other application's.
2. Seed those UUIDs as `Permission` objects in F+ ConfigDB. The
   simplest path is to extend `acs-service-setup` with a small
   helper - see `acs-service-setup/lib/grafana-permissions.js` for
   the canonical template (about 20 lines, idempotent, takes UUIDs
   from values.yaml). A hand-rolled script that calls
   `ConfigDB.create_object(Class.Permission, uuid)` and
   `put_config(App.Info, uuid, { name: "..." })` is also fine.
3. To grant a user a role, an admin uses the F+ ACL editor to grant
   the principal that permission UUID with `target=Wildcard`.
4. On the user's next login, the SPI surfaces those UUIDs in the
   `fp_permissions` JWT claim. Your application maps UUIDs to roles.

For applications that already speak OIDC role mapping, this often
reduces to a JMESPath expression. Grafana's role attribute path,
templated into `deploy/templates/grafana/grafana-ini.yaml`, is a good
template:

```
contains(fp_permissions[*], '<grafana-admin-uuid>') && 'GrafanaAdmin'
|| contains(fp_permissions[*], '<admin-uuid>')      && 'Admin'
|| contains(fp_permissions[*], '<editor-uuid>')     && 'Editor'
|| 'Viewer'
```

If your application supports "strict" role mapping, enable it. Many
apps will only ever *promote* a user from a token claim and never
demote them, which means a permission revoked in F+ doesn't take
effect on next login. Grafana's `role_attribute_strict: true` is the
flag that fixes this for Grafana; equivalents exist in most apps.

#### Option B - call back into Factory+ with the user's identity

Use this when authorization is dynamic, fine-grained, or per-object
(e.g. "can this user read device X?"). The application:

1. Reads `fp_principal_uuid` from the JWT.
2. Calls the F+ auth service (e.g. `GET /authz/acl`) on behalf of
   the user. Either:
   - mint a service-to-service token and ask "what can principal
     `<uuid>` do?" - acs-i3x is taking this approach, or
   - support the OAuth2 token-exchange flow once the i3x shim work
     lands (planned, not yet shipped).
3. Caches the answer for whatever TTL fits the app's freshness
   needs.

Either option avoids the duplicate-source-of-truth problem that
existed before this branch (where Keycloak roles and F+ ACLs had to
be administered separately).

## Worked example: minimal Express + openid-client

For a Node.js application using
[`openid-client`](https://www.npmjs.com/package/openid-client):

```js
import { Issuer } from "openid-client";
import fs from "node:fs/promises";

const baseUrl = process.env.ACS_BASE_URL;     // e.g. factoryplus.myorg.com
const realm   = process.env.OPENID_REALM;     // e.g. factory_plus
const name    = "myapp";
const proto   = process.env.ACS_SECURE === "true" ? "https" : "http";
const issuer  = `${proto}://openid.${baseUrl}/realms/${realm}`;

const client_secret = (await fs.readFile("/etc/oauth/client_secret", "utf8")).trim();

const oidc = await Issuer.discover(issuer);
const client = new oidc.Client({
    client_id:     name,
    client_secret,
    redirect_uris: [`${proto}://${name}.${baseUrl}/oauth2/callback`],
    response_types: ["code"],
});

// In a request handler, after the auth code callback:
const tokenSet = await client.callback(redirectUri, params, { code_verifier });
const claims   = tokenSet.claims();
// claims.fp_principal_uuid -> "f7e3a..."
// claims.fp_permissions    -> ["8d2f26ae-...", ...]
// claims.preferred_username -> "alice@FACTORYPLUS.MYORG.COM"
```

## Worked example: JupyterHub

A second concrete walkthrough, this one for an application installed
*alongside* ACS rather than shipped with it. JupyterHub is via the
official Z2JH chart; ACS code stays untouched. The pattern generalises
to any OIDC consumer.

### 1. Declare the OIDC client

Add to your ACS values:

```yaml
serviceSetup:
  config:
    openidClients:
      jupyterhub:
        enabled: true
        name: JupyterHub
        redirectPath: /hub/oauth_callback
```

`helm upgrade` ACS. service-setup will create the Keycloak client, the
`fp_principal_uuid` and `fp_permissions` mappers, and drop the auto-
generated client secret into `keycloak-clients/jupyterhub`. Verify:

```sh
kubectl -n factory-plus get secret keycloak-clients \
  -o jsonpath='{.data.jupyterhub}' | base64 -d
```

### 2. Create application-specific F+ permissions

JupyterHub-specific authz lives in F+, not in ACS internals. Open the
ACS Admin UI -> **ConfigDB** -> **Create Object**:

| Name | Type | UUID |
| --- | --- | --- |
| `JupyterHub admin` | `Permission (Rank 1 class)` | pick or auto-generate |
| `JupyterHub user`  | `Permission (Rank 1 class)` | pick or auto-generate |

Then **Access Control** -> **Principals** -> click the user (e.g.
`admin@<realm>`) -> add a grant: permission = `JupyterHub admin`,
target = **Wildcard**. Wildcard is the only target that surfaces in
`fp_permissions`; everything else is invisible to the consumer.

### 3. Install Z2JH with OIDC

Minimal values for the JupyterHub chart (`hub.jupyter.org/helm-chart`).
Substitute the client secret you fetched in step 1 and the two
permission UUIDs from step 2:

```yaml
hub:
  config:
    JupyterHub:
      authenticator_class: generic-oauth
    GenericOAuthenticator:
      client_id: jupyterhub
      client_secret: "<from keycloak-clients/jupyterhub>"
      oauth_callback_url: "http://jupyterhub.<acs.baseUrl>/hub/oauth_callback"
      authorize_url: "http://openid.<acs.baseUrl>/realms/factory_plus/protocol/openid-connect/auth"
      token_url:    "http://openid.<acs.baseUrl>/realms/factory_plus/protocol/openid-connect/token"
      userdata_url: "http://openid.<acs.baseUrl>/realms/factory_plus/protocol/openid-connect/userinfo"
      logout_redirect_url: "http://openid.<acs.baseUrl>/realms/factory_plus/protocol/openid-connect/logout"
      scope: [openid, profile]
      username_claim: preferred_username
      # OAuthenticator >= 17 requires this for admin_groups to be honoured.
      manage_groups: true
      # The OAuth response body lands under `oauth_user` in auth_state;
      # claim_groups_key is deprecated.
      auth_state_groups_key: oauth_user.fp_permissions
      admin_groups:
        - "<jupyterhub-admin permission UUID>"
      allowed_groups:
        - "<jupyterhub-admin permission UUID>"
        - "<jupyterhub-user permission UUID>"

proxy:
  service:
    type: ClusterIP

ingress:
  enabled: true
  hosts: ["jupyterhub.<acs.baseUrl>"]
  ingressClassName: acs-traefik    # matches the IngressClass installed by ACS
```

Install:

```sh
helm repo add jupyterhub https://hub.jupyter.org/helm-chart/
helm repo update
helm upgrade --install jupyterhub jupyterhub/jupyterhub \
  --namespace jupyterhub --create-namespace \
  -f jupyterhub-values.yaml
```

Visit `http://jupyterhub.<acs.baseUrl>`, sign in via the ACS Keycloak.
A user with the JupyterHub admin permission lands as a hub admin; a
user with only the user permission gets a regular hub session; anyone
else hits 403. No code in ACS knows about JupyterHub.

### What this exercises

| F+ piece | JupyterHub piece |
| --- | --- |
| OIDC client provisioned by service-setup | `client_id` + `client_secret` |
| `fp_principal_uuid` claim | `username_claim: preferred_username` (we use the UPN, but the UUID is also there for any app that wants it) |
| `fp_permissions` claim | `auth_state_groups_key: oauth_user.fp_permissions` + `admin_groups` / `allowed_groups` |
| F+ Permission objects | The "groups" JupyterHub gates on |
| F+ Wildcard-target ACL grant | Membership in those groups for a given user |

Nothing in JH is ACS-specific; the same shape applies to any OIDC
consumer that supports group-based gating.

## Reference: the Grafana wiring

If you want to see every piece in one place, Grafana is the canonical
example on this branch. Walk these files in order:

| Concern | File |
|---------|------|
| Helm values that declare the client | `deploy/values.yaml` (`serviceSetup.config.openidClients.grafana`) |
| Auto-generated client secret | `deploy/templates/openid/local-secrets.yaml` (LocalSecret -> `keycloak-clients` key `grafana`) |
| Client provisioning logic | `acs-service-setup/lib/openid.js` (`ensure_client`, `ensure_factoryplus_claim_mappers`) |
| Permission UUIDs seeded in F+ | `deploy/values.yaml` (`serviceSetup.config.grafanaPermissions`) and `acs-service-setup/lib/grafana-permissions.js` |
| OIDC config rendered for Grafana | `deploy/templates/grafana/grafana-ini.yaml` (auth/token/userinfo URLs and `role_attribute_path`) |
| Secret mount into the app | `deploy/values.yaml` (`grafana.extraSecretMounts`) |
| Grafana OAuth settings | `deploy/values.yaml` (`grafana.grafana.ini.auth.generic_oauth`) |

The same six layers exist for any client; only the application-specific
configuration changes.

## Constraints and gotchas

- **No email/firstName/lastName.** F+ has no profile fields, and the
  SPI is read-only. The closest thing to "email" is
  `preferred_username` (the Kerberos UPN). If your application
  requires an email-shaped value, use `preferred_username` (this is
  what Grafana does via `email_attribute_path: preferred_username`).
  Do not enable any feature that asks the user to fill in profile
  fields - the write will fail with `ReadOnlyException` from the SPI.
- **Permission propagation has two cache layers.** The SPI caches F+
  lookups for 60 seconds (configurable via the `cache.ttl.seconds`
  setting on the federation provider). On top of that, Keycloak's
  *user cache* memoises user attributes per-session - meaning a
  grant you make in F+ may not show up in `fp_permissions` even after
  the SPI cache expires, because Keycloak is still serving the
  attribute snapshot it captured when the user record was first
  loaded. The reliable invalidation today is `kubectl rollout
  restart deploy/openid`; for routine operator work, expect "grant
  the permission, restart openid, have the user sign in again."
  This is a sharp edge worth removing - see *Future work* in
  `acs-keycloak-spi/README.md` (set `cachePolicy: NO_CACHE` on the
  federation component so attribute changes propagate without a
  restart).
- **Realm name comes from values.yaml.** It is `factory_plus` by
  default (`openid.realm` in values). It must match what
  `grafana-ini.yaml` and any other client configmap reads, so if you
  change it in one place change it everywhere.
- **One realm only.** ACS is a single tenant; there is no multi-realm
  story.
- **Greenfield only.** Switching the federation source from Kerberos
  to Factory+ does not migrate existing federated user records. This
  branch's prior work is not yet in production; new deployments are
  fine, in-place upgrades from a Kerberos-federated realm need the
  realm rebuilt.
- **Public clients are not currently provisioned.** All clients
  created by service-setup are confidential. If you need a SPA / PKCE
  public client, edit it manually in Keycloak after first run, or
  open an issue to extend `openidClients` schema.
- **Per-client Keycloak roles are not used.** The previous design
  used `viewer`/`editor`/`admin`/`grafanaAdmin` roles per client.
  These are gone. Authorization is driven from F+ via the
  `fp_permissions` claim. Do not try to reintroduce per-client roles.

## Troubleshooting

### "redirect_uri does not match any registered URIs"

Most common cause: your application is served at a host other than
`<name>.<acs.baseUrl>`, or your `redirectPath` doesn't match the path
the application actually redirects to.

Check the registered URIs in the Keycloak admin UI (Clients ->
`<name>` -> Settings -> Valid redirect URIs). The clean fix is to set
`redirectUris` (and, if needed, `webOrigins` /
`postLogoutRedirectUris`) on the client entry in `values.yaml` and
re-run `helm upgrade` - service-setup will write the full list to
Keycloak and the change survives subsequent runs.

### `fp_permissions` is missing or empty

- Confirm the user is sourced from the `factoryplus` federation, not
  a local Keycloak user. Local users get no `fp_*` claims by design.
  Look at the user record in Keycloak: under "Federation Link" it
  should say `factoryplus`.
- Confirm the user has been granted the permission with
  `target=Wildcard` in F+. Permissions granted against any other
  target are not surfaced in `fp_permissions`. Check
  `acs-service-setup/lib/grafana-permissions.js` for the canonical
  pattern - the same shape works for any application's permissions.
- Wait for the SPI cache to expire (up to 60s) and have the user
  log in again.

### Login succeeds but the application shows no role / sees the user as a viewer

The application is receiving a token without the `fp_permissions`
claim, or with values that its role mapping doesn't recognise.

```bash
# decode the access token from your app's session and inspect the claims:
echo "<jwt>" | cut -d. -f2 | base64 -d | jq
```

If `fp_permissions` is present but your mapping returns the wrong
role, the JMESPath / role-mapping config is the place to look. If it's
absent, see the previous section.

### Backchannel logout doesn't take effect

Confirm the application supports OIDC backchannel logout and that you
have not disabled it. ACS sets
`backchannel.logout.session.required: true` on every client; the
application must implement the backchannel logout endpoint for this
to work. If it doesn't, force-logouts in Keycloak will only take
effect after the application's local session expires or its access
token's TTL elapses.

### Email-related Grafana errors (e.g. 404 from a `/emails` endpoint)

Grafana defaults to fetching email from a GitHub-shaped `/emails`
endpoint that Keycloak doesn't expose. The fix that lives in
`grafana-ini.yaml` is `email_attribute_path: preferred_username`. If
you're configuring a different application that has the same default,
apply the equivalent there.

### `ReadOnlyException` in the Keycloak logs on login

The application (or Keycloak's own required actions) tried to write
back to the federated user record. The SPI is read-only.
service-setup explicitly disables `UPDATE_PROFILE`,
`VERIFY_PROFILE`, and `VERIFY_EMAIL` for this reason. If you've
enabled another required action that writes to the user, disable it.

### Inspecting what a user's JWT actually contains

When `fp_permissions` looks wrong (missing UUIDs, stale, etc.), bypass
the application and look at the token directly.

1. **Verify the grant exists in F+.** Quickest path is the ACS MCP
   server (if you have it wired up) or the F+ Auth HTTP API. With MCP:

   ```
   mcp__acs__find_grants(principal=<user-uuid>)
   mcp__acs__get_grant(uuid=<grant-uuid>)
   mcp__acs__check_acl(principal=<user-uuid>,
                       permission=<perm-uuid>,
                       target=00000000-0000-0000-0000-000000000000,
                       wild=true)
   ```

   Confirm the target is `00000000-0000-0000-0000-000000000000`
   (Wildcard). Anything else is invisible to `fp_permissions`.

2. **Temporarily enable direct access grants on the client** so you
   can password-grant a token without a browser flow:

   ```sh
   kubectl -n factory-plus exec deploy/openid -c keycloak -- /bin/sh -c '
     /opt/keycloak/bin/kcadm.sh config credentials \
       --server http://localhost:8080 --realm master \
       --user _bootstrap --password "$KC_BOOTSTRAP" >/dev/null
     /opt/keycloak/bin/kcadm.sh update clients/<client-id> \
       -r factory_plus -s directAccessGrantsEnabled=true'
   ```

   (Get the bootstrap password from the `keycloak-clients/_bootstrap`
   secret. `<client-id>` is the Keycloak-internal UUID of the OIDC
   client, *not* the `clientId` string - find it with
   `kcadm.sh get clients -r factory_plus -q clientId=<name>`.)

3. **Fetch a token and decode it.**

   ```sh
   CS=$(kubectl -n factory-plus get secret keycloak-clients \
          -o jsonpath='{.data.<client>}' | base64 -d)
   curl -s -X POST \
     "http://openid.<acs.baseUrl>/realms/factory_plus/protocol/openid-connect/token" \
     -d grant_type=password -d client_id=<client> -d client_secret="$CS" \
     -d username=<user>@<REALM> -d password=<user-pw> \
     -d "scope=openid profile" \
   | jq -r '.access_token' \
   | awk -F. '{print $2}' | base64 -d 2>/dev/null | jq
   ```

   The JWT payload includes the issued `fp_permissions` array. If the
   grant you expected isn't in the array, it's an SPI/cache issue
   (next step). If it is in the array but the application still
   rejects you, the application's role-mapping config is the problem
   (check its docs for the equivalent of Grafana's `role_attribute_path`).

4. **Flush Keycloak's user cache.** If the grant is fresh and isn't
   appearing, the most likely reason is Keycloak's per-user attribute
   cache (see the *Constraints and gotchas* section above). Restart
   the openid pod, then have the user sign in again:

   ```sh
   kubectl -n factory-plus rollout restart deploy/openid
   ```

5. **Turn direct access grants back off** when you're done. Same
   command as step 2 with `directAccessGrantsEnabled=false`.

### Service-setup keeps creating duplicate clients

Should not happen on a healthy install. If it does, inspect the
Keycloak admin UI for orphaned clients with the same `clientId` -
historically this was caused by passing the realm *name* instead of
the realm *UUID* as `parentId`. The current code resolves the realm
UUID first; if you see this, file an issue with the service-setup
log output.

## Further reading

- `docs/plans/2026-05-07-keycloak-fp-user-storage-spi.md` - the pitch
  explaining why ACS owns Keycloak and a custom SPI rather than
  letting Keycloak's roles be the source of truth.
- `acs-keycloak-spi/README.md` - what the SPI plugin does and how to
  extend it.
- `acs-service-setup/lib/openid.js` - the provisioning code; the
  authoritative description of what each `openidClients` field does.
