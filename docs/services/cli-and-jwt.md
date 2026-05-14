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

> **In a hurry?** Import [`docs/Factory+.postman_collection.json`](../Factory+.postman_collection.json)
> into Postman. It has the OAuth config pre-baked plus 120+ requests
> covering every F+ HTTP service. Set the `domain` collection variable
> to your cluster's base hostname and you're done.

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

## How services validate the JWT

Every F+ service that uses `lib/js-service-api` accepts JWTs on the
`Authorization: Bearer` header. The middleware:

1. Notices the token is a JWT (3 base64url segments with a JWT
   header), as opposed to the existing opaque session tokens which
   have no dots.
2. Lazily fetches the configured Keycloak's JWKS via
   `OIDC_DISCOVERY_URL` (set by the chart).
3. Validates signature, issuer, and expiry.
4. Reads `fp_principal_uuid` from the JWT and sets `req.auth` to it.
5. Stashes the raw JWT in an AsyncLocalStorage scope so the
   service-client can forward it on outbound calls to other F+
   services. Existing ACL logic on `req.auth` is unchanged.

If `OIDC_DISCOVERY_URL` is unset (openid disabled in the chart) the
middleware simply doesn't accept JWTs - opaque tokens, Basic, and
Negotiate continue working as before.

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
