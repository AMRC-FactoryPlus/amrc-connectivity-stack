# Calling F+ services directly with a Keycloak JWT

This document covers the use case where a human user (or a script
acting as one) needs to call an ACS HTTP API directly: with Postman,
`curl`, a one-off Node script, or any tool that isn't a full OAuth web
app. The flow gets the user a JWT from Keycloak and presents it as a
Bearer token on requests to any F+ service. Each service validates the
JWT and runs its existing ACL checks against the JWT's principal.

This is the path acs-i3x is designed for. It also works against any
other F+ service that's been picked up by the new
`lib/js-service-api` (auth, configdb, directory, files, cmdesc,
cluster-manager, git, i3x).

> **Audience:** developers and operators who want to hit an ACS REST
> API as themselves. Not for application sign-in (use the
> Authorization Code flow described in
> [oauth-clients.md](./oauth-clients.md)) and not for service-to-service
> calls (those use the cluster-local Kerberos identity).

> **In a hurry?** Use the [Postman collection](../../postman/) - it has
> OAuth pre-configured plus 127 requests covering every F+ HTTP service.
> See [`postman/README.md`](../../postman/README.md) for setup.

## How it works at a glance

```
   Postman / curl
        │  1. Auth Code + PKCE against Keycloak
        ▼
   Keycloak realm "factory_plus"      ← acs-cli client (public, PKCE)
        │  2. Returns access_token (JWT)
        ▼
   Postman holds JWT
        │  3. Authorization: Bearer <JWT>
        ▼
   F+ service (e.g. i3x)              ← lib/js-service-api validates
        │  4. Validates signature + iss against Keycloak JWKS
        │     Reads fp_principal_uuid claim → req.auth
        │  5. Outbound service-client calls forward the same JWT
        ▼
   Downstream F+ services             ← also validate the JWT
        │
        ▼
   Existing ACL checks run as the user
```

The acs-cli Keycloak client is a **public** client (no client secret)
with PKCE S256 enforced. That's secure enough for Postman/curl - the
PKCE code verifier prevents the authorization code from being usable
by anyone except the original initiator, and there's no secret to leak.

## One-time setup: the `acs-cli` Keycloak client

`service-setup` provisions the client automatically. On a fresh
`helm install` or `helm upgrade` against this chart you don't need to
do anything. To confirm:

```sh
kubectl exec -n <ns> deploy/openid -- \
    curl -s http://localhost:8080/realms/factory_plus/.well-known/openid-configuration \
  | jq .authorization_endpoint
```

If you need to disable it, set `serviceSetup.config.openidClients.acs-cli.enabled: false`
in your values.yaml. To customise the redirect URIs (e.g. point at a
different Postman tenant or a different localhost dev tool), override
`redirectUris` on that same value:

```yaml
serviceSetup:
  config:
    openidClients:
      acs-cli:
        redirectUris:
          - https://oauth.pstmn.io/v1/callback
          - http://localhost/*
          - http://127.0.0.1/*
          - https://your-postman-team.postman.co/oauth2/callback
```

## Postman: Authorization Code + PKCE

1. Open the request in Postman, go to the **Auth** tab.
2. Set Type to `OAuth 2.0`.
3. Click **Get New Access Token**.
4. Fill in:

   | Field                  | Value                                                                          |
   |------------------------|--------------------------------------------------------------------------------|
   | Token Name             | anything, e.g. `acs-dev`                                                       |
   | Grant Type             | `Authorization Code (With PKCE)`                                               |
   | Callback URL           | `https://oauth.pstmn.io/v1/callback` (leave Postman's default)                 |
   | Auth URL               | `https://openid.<acs-base>/realms/factory_plus/protocol/openid-connect/auth`   |
   | Access Token URL       | `https://openid.<acs-base>/realms/factory_plus/protocol/openid-connect/token`  |
   | Client ID              | `acs-cli`                                                                      |
   | Client Secret          | leave blank                                                                    |
   | Code Challenge Method  | `SHA-256`                                                                      |
   | Scope                  | `openid`                                                                       |
   | Client Authentication  | `Send client credentials in body`                                              |

5. Click **Get New Access Token**. Your browser opens to Keycloak.
   Log in with your F+ username and password.
6. The browser redirects back; Postman captures the access token.
7. Click **Use Token**. The Authorization header is set for all
   subsequent requests in this collection.

Postman handles refresh automatically via the refresh token.

## curl / scripts: Device Authorization Grant

For headless scripts (CI, one-off automation) you can use RFC 8628:

```sh
BASE=https://openid.<acs-base>/realms/factory_plus/protocol/openid-connect

# 1. Start the flow.
RESP=$(curl -s -X POST "$BASE/auth/device" \
    -d client_id=acs-cli -d scope=openid)
DEVICE_CODE=$(echo "$RESP" | jq -r .device_code)
echo "Open: $(echo "$RESP" | jq -r .verification_uri_complete)"

# 2. Open the URL printed above in a browser, log in.

# 3. Poll for the token.
while true; do
    TOK=$(curl -s -X POST "$BASE/token" \
        -d grant_type=urn:ietf:params:oauth:grant-type:device_code \
        -d device_code="$DEVICE_CODE" \
        -d client_id=acs-cli)
    if echo "$TOK" | jq -e .access_token >/dev/null; then
        break
    fi
    sleep 5
done
JWT=$(echo "$TOK" | jq -r .access_token)
```

Now use `$JWT`:

```sh
curl -H "Authorization: Bearer $JWT" \
    "https://i3x.<acs-base>/v1/things/<uuid>"
```

## Which services accept JWTs

Every F+ service that picks up the new `lib/js-service-api` accepts
JWTs by default on the `Authorization: Bearer` header. On a current
deployment that's:

- `acs-auth` (with the caveat that `req.auth` is the principal UUID
  when authenticated via JWT - identity-resolution endpoints handle
  this internally)
- `acs-configdb`
- `acs-directory`
- `acs-cmdesc`
- `acs-files`
- `acs-git`
- `acs-cluster-manager` (clusters subdomain)
- `acs-i3x`

The chart wires `OIDC_DISCOVERY_URL` into all eight services via the
shared `amrc-connectivity-stack.oidc-env` helper, so opting a new
service in is a single-line include in its deployment template.

The MQTT broker also accepts JWTs: present the JWT as the MQTT
password (the username is ignored; identity comes from the verified
token's `preferred_username`). The HiveMQ plugin validates against
the same realm via `OIDC_DISCOVERY_URL` and runs the normal MQTT ACL
lookup for that principal.

## The visualiser

The visualiser is a browser SPA and logs in via the Keycloak login
page (Authorization Code + PKCE, client `visualiser`), holding the
JWT in the browser. It refreshes the token before expiry and uses it
for the Directory, ConfigDB and the MQTT websocket connection.
Pressing Escape logs out via Keycloak's end-session endpoint.

For unattended kiosk displays it also supports Grafana-style URL
login: `https://visualiser.<acs-base>/?auth_token=<JWT>` bypasses
login entirely. The token is stripped from the address bar
immediately. No refresh is possible in this mode, so mint the token
from a service-account client with a long `accessTokenLifespan` (see
`values.yaml` `serviceSetup.config.openidClients`).

## How services validate the JWT

The auth middleware in `lib/js-service-api`:

1. Notices the token is a JWT (3 base64url segments with a JWT
   header), as opposed to the existing opaque session tokens which
   have no dots.
2. Lazily fetches the configured Keycloak's JWKS via
   `OIDC_DISCOVERY_URL` (the URL is set by the chart). The fetch is
   on first JWT seen, not at service start - so Keycloak being
   unavailable at boot doesn't break the service.
3. Validates signature, issuer, and expiry against the realm's
   public keys. `jose` handles JWKS caching and `kid` rotation
   internally.
4. Reads `fp_principal_uuid` from the JWT and sets `req.auth` to
   that UUID. Existing ACL logic on `req.auth` is unchanged: the
   service-client and auth-service both normalise UUID and UPN
   inputs so the same ACL pipeline runs regardless of which auth
   path the caller used.
5. Stashes the raw JWT in an AsyncLocalStorage scope so the
   service-client can forward it on outbound calls (see below).

If `OIDC_DISCOVERY_URL` is unset (openid disabled in the chart) the
middleware simply doesn't accept JWTs - opaque tokens, Basic, and
Negotiate continue working as before.

## Identity forwarding on outbound calls

When a JWT-authenticated request inside an F+ service makes outbound
calls to other F+ services, `lib/js-service-client` forwards the
same JWT verbatim. Application code is unchanged: where you would
have written

```js
await fplus.ConfigDB.get_config(app, object);
```

the service-client picks up the inbound JWT from AsyncLocalStorage
and sends it on the downstream HTTP request as `Authorization:
Bearer <same JWT>`. The downstream service validates the JWT itself
and runs ACLs against the original user's principal.

What this means in practice: when acs-i3x receives a third-party
request and fans out to ConfigDB / Directory / Influx, the user's
identity is preserved end-to-end. No token-exchange step. No
per-service token cache. No special "on-behalf-of" plumbing in
service handlers.

If there's no JWT in scope (an existing Kerberos- or Basic-
authenticated request), service-client keeps doing exactly what it
did before: negotiate Kerberos, mint a per-service opaque session
token, reuse for the request lifetime.

## Verifying it on a cluster

After a fresh deploy, the [JWT auth test playbook](../plans/2026-05-13-jwt-auth-test-playbook.md)
walks through end-to-end verification: confirming the Keycloak
client is provisioned, the env var is set on every service,
obtaining a JWT, hitting i3x as yourself, watching identity forward
through to ConfigDB in the logs, and regression-testing the existing
auth methods.

## Requirements

- ACS **v5.2.0-i3x.6 or newer** (the JWT auth feature shipped on that
  release). Older releases reject Keycloak JWTs and fall back to
  Basic / Negotiate / opaque Bearer.
- `openid.enabled: true` in your Helm values (the default).
- Operators upgrading from an older release: `helm upgrade` is
  sufficient. service-setup will provision the `acs-cli` client
  automatically and wire `OIDC_DISCOVERY_URL` into every F+ service.

## Troubleshooting

### `401 Unauthorized` on every request

The JWT isn't reaching validation. Check, in order:

1. Token has Bearer prefix on the wire (`Authorization: Bearer <jwt>`,
   not `Authorization: <jwt>`).
2. Token hasn't expired:
   ```sh
   echo "$JWT" | cut -d. -f2 | base64 -d 2>/dev/null | jq .exp
   ```
3. Issuer in the JWT matches what the service expects:
   ```sh
   echo "$JWT" | cut -d. -f2 | base64 -d 2>/dev/null | jq .iss
   kubectl exec -n <ns> deploy/<service> -- env | grep OIDC_DISCOVERY_URL
   ```
4. Service can reach Keycloak:
   ```sh
   kubectl exec -n <ns> deploy/<service> -- \
     wget -qO- "$OIDC_DISCOVERY_URL" | jq .jwks_uri
   ```
5. Service log shows the actual rejection reason:
   ```sh
   kubectl logs -n <ns> deploy/<service> --tail=50 | grep -iE "auth|jwt"
   ```

### `403 Forbidden`

Auth succeeded; you don't have permission. Hit `/v2/whoami/uuid` on
auth to confirm the principal UUID, then `/v2/acl/<that-uuid>` to see
your grants. The principal exists but lacks the right grant for the
resource you're hitting.

### Service has no `OIDC_DISCOVERY_URL`

Means the chart upgrade didn't apply the new helper to that
deployment, or the deployment template was missed when the helper
was added. Confirm with:

```sh
for d in auth configdb directory i3x cmdesc files git cluster-manager; do
  v=$(kubectl get deploy -n <ns> $d \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="OIDC_DISCOVERY_URL")].value}')
  echo "$d: ${v:-<MISSING>}"
done
```

A missing entry on a service that exists in the cluster needs a
chart fix (add `{{ include "amrc-connectivity-stack.oidc-env" . | indent 12 }}`
to its env block) and a redeploy.

### Browser-built bundles fail to compile with `node:async_hooks`

If you import service-client into a browser-bundled app (acs-admin
via Vite, or anything similar), make sure you're on lib/js-service-client
≥ 1.6.0. Earlier versions did a static `import` of `node:async_hooks`
which fails when bundling for the browser; the current version uses
a dynamic import with a no-op stub for browser callers.

### Keycloak is down at service start

Services start fine; JWKS is fetched lazily on the first JWT seen.
Any incoming JWT request during a Keycloak outage gets a 401 with a
network-error log; normal behaviour resumes when Keycloak is back.
Cold-start order is not load-bearing.

## What's deliberately out of scope

- **ROPC (password grant) is disabled** on the `acs-cli` client.
  Deprecated in OAuth 2.1.
- **No token revocation by `jti`**. JWTs remain valid until their
  natural expiry even after a Keycloak logout.
- **No CORS configuration for browser callers** - the audience is
  curl/Postman/server-to-server. Browser apps should use the
  conventional [OIDC client flow](./oauth-clients.md) with their own
  Keycloak client.
- **No support for non-Keycloak issuers**. Only the cluster's own
  realm is trusted.
- **`fp_permissions` claim is ignored for ACL decisions.** ACL checks
  always read live from F+ auth so revocations take effect on the
  next request rather than waiting for the JWT to expire.
