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

The `info` folder's pings opt out of auth so you can smoke-test
reachability before getting a token. (i3x's `/v1/info` is the only
non-ping that's publicly routed.)

## Running the whole collection

Right-click the collection → **Run collection** (or hit the play arrow
next to its name). The Collection Runner sends every request in order,
executes its test scripts, and shows pass/fail per-request.

## Test scripts and live data

Each GET request has tests attached that assert the response status
is what we expect from an authenticated admin. There's no hand-coded
list of UUIDs - the collection chains itself:

1. **List endpoints set collection variables.** `auth/v2/whoami (uuid
   only)` runs first and stashes the caller's UUID into
   `principalUuid`. Other list endpoints follow the same pattern:
   `list devices` sets `deviceUuid`, `list classes` sets `classUuid`,
   etc.
2. **Get-by-id endpoints reference those variables.** `get principal`'s
   URL is `/v2/principal/{{principalUuid}}` rather than a hardcoded
   UUID, so it works against any cluster.
3. **Assertions are strict by default.** Lists expect 200. Get-by-id
   requests expect 200 or 404 (404 only if the upstream list returned
   empty / wasn't run). Anything else - 401, 403, 5xx, 400 - fails.

The variables show up under the collection's **Variables** tab with
empty initial values; they get populated as the run progresses. Open
that tab during a run to watch them fill in.

If a get-by-id test fails because a variable is empty, the failure
message points you at the upstream list endpoint that should have
populated it.

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

- [`docs/auth/`](../docs/auth/) - the auth section. Start with the
  [overview](../docs/auth/README.md), then drill into:
  - [Direct API access with a Keycloak JWT](../docs/auth/cli-and-jwt.md) -
    the flow this collection uses (Auth Code + PKCE, plus curl via
    Device Authorization Grant for headless scripts).
  - [Connecting OAuth applications](../docs/auth/oauth-clients.md) -
    configuring new OIDC clients for web applications (different use
    case from this collection - that one's for first-party web apps).
