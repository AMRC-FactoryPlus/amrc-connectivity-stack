# Authentication

ACS services accept three forms of authentication on HTTP endpoints.
Pick the one that matches your caller; all three are validated on the
same `Authorization` header and converge on the same ACL pipeline.

## At a glance

| Scheme | Used by | Doc |
|---|---|---|
| **Kerberos** (Negotiate / Basic) | Service-to-service traffic, cluster-internal callers, anything with a keytab. The historical path. | (built in - no setup beyond a keytab) |
| **OIDC web flow** | Web applications that sign users in via Keycloak (Grafana, JupyterHub, your own app). | [oauth-clients.md](./oauth-clients.md) |
| **Direct Keycloak JWT** | Humans / scripts hitting an ACS API directly with Postman, curl, or any tool that isn't a full OAuth web app. | [cli-and-jwt.md](./cli-and-jwt.md) |

## How services pick

Each F+ service detects the scheme from the wire:

- `Authorization: Negotiate <token>` → Kerberos GSSAPI.
- `Authorization: Basic <base64(user:pass)>` → Kerberos verified via the keytab.
- `Authorization: Bearer <jwt>` → Keycloak JWT validated against JWKS (when `OIDC_DISCOVERY_URL` is set on the service).
- `Authorization: Bearer <opaque>` → opaque session token previously minted by this service's `/token` endpoint.

Whichever path the request comes in on, `req.auth` ends up holding a
principal identifier (Kerberos UPN or principal UUID) that the ACL
pipeline accepts.

## Identity stays consistent end-to-end

When an F+ service receives a JWT-authenticated request and makes
outbound calls to other F+ services (for example, acs-i3x fanning
out to ConfigDB / Directory / Influx), `lib/js-service-client`
forwards the same JWT verbatim. The downstream service validates the
JWT itself and runs its ACL checks against the original caller. No
token-exchange step, no per-service token cache, no special
on-behalf-of plumbing in handlers.

See [cli-and-jwt.md → Identity forwarding](./cli-and-jwt.md#identity-forwarding-on-outbound-calls)
for the detail.

## Tooling

A [ready-to-import Postman collection](../../postman/) covers every
HTTP-facing F+ service with OAuth pre-configured. Set the `domain`
collection variable to your cluster, click **Get New Access Token**,
and you're hitting APIs as yourself.

## When to use which

- **Setting up Grafana / JupyterHub / a Vue or React app**:
  [oauth-clients.md](./oauth-clients.md). Browser-based authorization
  code flow with a confidential client and redirect URI.
- **Testing an endpoint as yourself / scripting against the cluster
  / wiring up Postman**: [cli-and-jwt.md](./cli-and-jwt.md). Uses
  the pre-provisioned `acs-cli` public client - no per-app setup
  needed.
- **An edge agent or service running inside the cluster**: nothing
  in this folder - those continue to use Kerberos via their keytab,
  managed by krb-keys-operator.
