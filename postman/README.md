# Factory+ Postman collection

A ready-to-use Postman collection covering every HTTP-facing service
in the AMRC Connectivity Stack: auth, configdb, directory, cmdesc,
files, git, cluster-manager and i3x. 127 requests, OAuth 2.0 set up
once at the collection level, no per-request fiddling.

## What's in it

| Folder | Coverage |
|---|---|
| `info` | `/ping` on every service + i3x `/v1/info`. Public, no auth. |
| `auth` | `/v2` modern API + still-used legacy `/authz` endpoints + `/load` + `/token`. |
| `configdb` | `/v2` (objects, classes, class relations, configs) + `/v1` (search, schemas, load). |
| `directory` | Devices, addresses, schemas, service advertisements, alerts, links. |
| `cmdesc` | Sparkplug command escalation by node/device address. |
| `files` | List/get/put/post on the blob store. |
| `git` | Repo status and storage management. (Use `git` itself for clone/push/fetch.) |
| `cluster-manager` | Edge-cluster provisioning, bootstrap manifests, sealed-secret ops. |
| `i3x` | i3X v1 REST/SSE - namespaces & types, objects, subscriptions. |

Services not listed (acs-monitor, historians, edge agents,
uns-ingesters) speak only Sparkplug/MQTT and have no HTTP surface to
test.

## Setup (one-time)

The collection is OAuth-only. It uses the `acs-cli` public Keycloak
client that service-setup provisions automatically on `helm install`
or `helm upgrade`.

1. Import `Factory+.postman_collection.json` into Postman
   (drag & drop, or **File → Import**, or via the "Work with your
   local codebase" workspace pointed at this repo).
2. Click the collection → **Variables** tab. Set:
   - `scheme`: `https` (or `http` for local/dev clusters)
   - `domain`: your cluster's base hostname (the `acs.baseUrl` value
     in your Helm values, e.g. `acs.example.com`)
3. Click **Save**.

## Get a token

1. Collection → **Authorization** tab → scroll down → **Get New Access
   Token**.
2. A browser tab opens to Keycloak. Log in with your F+ credentials.
3. Browser redirects back; Postman captures the JWT. Click **Use
   Token**.

Tokens last 5 minutes by default; Postman auto-refreshes via the
refresh token, so once you've logged in once you can keep hitting
requests for the rest of the SSO session without re-authenticating.

## Use it

Every request inherits the collection-level OAuth, so just open any
folder and click **Send**.

Requests with placeholders (`:uuid`, `:app`, `:object`, etc.) expose
them in the **Path Variables** table below the URL bar - fill those
in rather than editing the raw URL.

The `info` folder's pings explicitly opt out of auth via per-request
`noauth`, so you can use them to smoke-test reachability before
getting a token.

## Switching clusters

Edit the `scheme` and `domain` collection variables, hit **Save**, and
click **Get New Access Token** again (the previous token was for a
different realm). Every request URL re-derives from `{{scheme}}://<service>.{{domain}}<path>`,
so nothing else needs to change.

## Requirements

The cluster must be running ACS **v5.2.0-i3x.6 or newer** (the JWT auth
feature shipped on that release). Older releases reject Keycloak JWTs
and need Basic or Negotiate auth instead - this collection won't work
against them as-is.

## Contributing changes

If you point Postman at this repo via "Work with your local codebase",
edits in Postman become normal file changes you can commit:

```sh
git status   # postman/Factory+.postman_collection.json will be modified
git diff postman/
git add postman/Factory+.postman_collection.json
git commit
```

Otherwise: export from Postman (right-click collection → Export →
Collection v2.1) and overwrite the file.

Either way, please keep:

- OAuth 2.0 at the collection level (don't switch to per-request).
- The `{{scheme}}://<service>.{{domain}}<path>` URL convention.
- The `acs.example.com` placeholder in the `domain` variable's *initial*
  value, so the file in the repo doesn't ship pre-pointed at any
  specific cluster. (Set your own cluster in the *current* value column
  - that one isn't persisted to the file.)

## See also

- [`docs/services/cli-and-jwt.md`](../docs/services/cli-and-jwt.md) -
  how the JWT flow works end-to-end and how to use it from curl /
  Device Authorization Grant for headless scripts.
- [`docs/services/oauth-clients.md`](../docs/services/oauth-clients.md) -
  configuring new OIDC clients for web applications (different use
  case from this collection - this one's for direct API access).
