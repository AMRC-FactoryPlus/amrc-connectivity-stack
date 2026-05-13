# JWT auth — manual test playbook

Step-by-step verification for the JWT auth feature on a real dev
cluster, after cutting a release that includes this branch and helm
upgrading.

Substitute `<acs-base>` for your cluster's base domain throughout (the
value of `acs.baseUrl` in your values.yaml). Substitute `<ns>` for the
namespace you deployed into (typically `factory-plus`).

## 0. Prerequisites

- Cluster running ACS with this release. `helm upgrade` has succeeded.
- You have an F+ user account (e.g. `alex@<KERBEROS-REALM>`) with
  some ACL grants for testing.
- Postman installed locally (or curl + jq).
- `kubectl` configured against the cluster.

## 1. Confirm service-setup provisioned the `acs-cli` Keycloak client

```sh
kubectl exec -n <ns> deploy/openid -- \
  curl -s -u "_bootstrap:$(kubectl -n <ns> get secret keycloak-clients -o jsonpath='{.data._bootstrap}' | base64 -d)" \
    -X POST -d 'grant_type=password&client_id=admin-cli&username=_bootstrap&password='"$(kubectl -n <ns> get secret keycloak-clients -o jsonpath='{.data._bootstrap}' | base64 -d)" \
    http://localhost:8080/realms/master/protocol/openid-connect/token | jq -r .access_token > /tmp/admin.tok

kubectl exec -n <ns> deploy/openid -- \
  curl -s -H "Authorization: Bearer $(cat /tmp/admin.tok)" \
    "http://localhost:8080/admin/realms/factory_plus/clients?clientId=acs-cli" \
  | jq '.[0] | {clientId, publicClient, standardFlowEnabled, directAccessGrantsEnabled, attributes}'
```

Expected:

```json
{
  "clientId": "acs-cli",
  "publicClient": true,
  "standardFlowEnabled": true,
  "directAccessGrantsEnabled": false,
  "attributes": {
    "pkce.code.challenge.method": "S256",
    "oauth2.device.authorization.grant.enabled": "true",
    ...
  }
}
```

If the client is missing, check service-setup's logs:

```sh
kubectl logs -n <ns> -l job-name=service-setup --tail=200 | grep -i acs-cli
```

## 2. Confirm every F+ service has `OIDC_DISCOVERY_URL` wired

```sh
for d in i3x auth configdb directory files cmdesc clusters git; do
  url=$(kubectl get deploy -n <ns> $d -o jsonpath='{.spec.template.spec.containers[?(@.name)].env[?(@.name=="OIDC_DISCOVERY_URL")].value}' 2>/dev/null)
  echo "$d -> ${url:-<MISSING>}"
done
```

Expected: every deployment shows a URL like
`https://openid.<acs-base>/realms/factory_plus/.well-known/openid-configuration`.

(If a deployment shows `<MISSING>` and openid is enabled, the chart
upgrade didn't pick up the helper. Re-run the upgrade.)

## 3. Get a JWT as yourself via Postman

Follow [docs/services/cli-and-jwt.md](../services/cli-and-jwt.md)
"Postman: Authorization Code + PKCE". After logging in, click
**Use Token** and copy the access token from Postman's token detail
view for the next step.

Sanity-check the JWT payload:

```sh
echo "<paste JWT>" | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```

You should see:

```json
{
  "iss": "https://openid.<acs-base>/realms/factory_plus",
  "fp_principal_uuid": "<your-F+-uuid>",
  "fp_permissions": [ "<uuid>", "<uuid>", ... ],
  "preferred_username": "alex",
  "exp": <unix>,
  ...
}
```

If `fp_principal_uuid` is missing, the SPI claim mappers aren't on the
acs-cli client. Re-run service-setup:

```sh
kubectl delete job -n <ns> service-setup
helm upgrade <release> deploy --values ...
```

## 4. Hit a public endpoint (smoke test, no auth needed)

```sh
curl -s "https://i3x.<acs-base>/v1/info" | jq .
```

This should return without any auth header at all, since `/v1/info`
is on i3x's public-route allow-list. Confirms i3x is up and reachable
before adding auth complexity.

## 5. Hit i3x as yourself

```sh
JWT="<paste JWT>"
curl -s -H "Authorization: Bearer $JWT" \
  "https://i3x.<acs-base>/v1/things" | jq '.objects[0:3]'
```

Expected: 200 with a list of things you have permission to see. If
you get back a *different* set of things from what you'd expect, the
ACL filtering on your principal is wrong - but the JWT auth itself
worked.

If you get **401**:
- Re-check the JWT hasn't expired (`exp` claim).
- Check i3x logs for the auth failure reason:
  ```sh
  kubectl logs -n <ns> deploy/i3x --tail=100 | grep -i auth
  ```

If you get **500 / 503**:
- i3x can probably reach Keycloak but JWKS fetch is failing. Check
  the URL it's actually fetching:
  ```sh
  kubectl exec -n <ns> deploy/i3x -- \
    sh -c 'wget -qO- "$OIDC_DISCOVERY_URL"' | jq .
  ```

## 6. Confirm i3x forwards your identity downstream

Make a request that requires i3x to call ConfigDB on your behalf. For
example, fetch a specific thing by UUID - i3x's handler calls
`fplus.ConfigDB.get_config(...)`.

```sh
THING_UUID="<a UUID you have read access to>"
curl -s -H "Authorization: Bearer $JWT" \
  "https://i3x.<acs-base>/v1/things/$THING_UUID" | jq .
```

Expected: 200 with the thing's metadata, ACL-filtered for you.

Tail both i3x and configdb logs to watch the JWT forwarding:

```sh
# Terminal A
kubectl logs -n <ns> -f deploy/i3x | grep -iE "auth|token|JWT"
```

```sh
# Terminal B
kubectl logs -n <ns> -f deploy/configdb | grep -iE "auth|token|JWT"
```

You should see i3x log `Handling Bearer auth` then `Auth succeeded for
[<your-F+-uuid>]`, then `Forwarding JWT ey... to <configdb-url>`, then
configdb logs the same `Handling Bearer auth` and `Auth succeeded for
[<your-F+-uuid>]`. That's the round-trip you're verifying.

## 7. Confirm a user without permission gets ACL-denied (not auth-denied)

Pick a thing you do *not* have read permission on (or revoke one of
your permissions and re-issue a JWT). Hit it:

```sh
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $JWT" \
  "https://i3x.<acs-base>/v1/things/<denied-uuid>"
```

Expected: **403** (or 404 if the policy is to hide existence). Not
401. This confirms ACL is being run on your identity rather than i3x
being treated as the caller (which would have been the bug behaviour
before this change).

## 8. Confirm existing auth methods still work

Quick regression check that we haven't broken Kerberos or opaque
Bearer:

```sh
# From within the cluster, using a service principal:
kubectl exec -n <ns> deploy/i3x -- \
  sh -c 'KRB5CCNAME=$(k5start -tUf $CLIENT_KEYTAB -- printenv KRB5CCNAME 2>/dev/null); \
         curl -s --negotiate -u : http://i3x/v1/info'
```

Should return the same `/v1/info` payload. (Public endpoint, so the
negotiate fallback doesn't gate the body, but the negotiate handshake
should complete without 401.)

For opaque token: from inside any other F+ service pod, the existing
service-to-service path continues to use `/token` and opaque bearer
tokens. No change expected.

## 9. Confirm JWT works against other F+ services (bonus)

This validates the "every F+ service accepts JWTs" property of the
change. Pick one:

```sh
curl -s -H "Authorization: Bearer $JWT" \
  "https://configdb.<acs-base>/v1/app" | jq '. | length'
```

Expected: 200, with the count of apps your principal can see. If you
get 401, configdb didn't get the new lib version - rebuild and
redeploy it.

## 10. Failure modes worth probing

- **Expired JWT**: wait an hour, retry step 5. Expect 401 with the
  reason "exp validation failed" in i3x logs.
- **Tampered JWT**: change the last character of the JWT and retry.
  Expect 401 with "signature validation failed".
- **Keycloak down**: scale openid to 0, try a fresh request with a
  not-yet-cached `kid`. Expect 401 / "JWKS fetch failed". Bring
  openid back up; new requests should recover.
- **Helm upgrade onto openid-disabled values**: set
  `openid.enabled: false`, upgrade, retry step 5 with the old JWT.
  Expect 401 (no JWT validation), but Negotiate/Basic still work for
  cluster-internal callers.

## What "good" looks like

After running steps 1-7 in order, you should have:

- A copy-paste-able JWT for your user from Postman.
- 200 responses on i3x endpoints, with ACL-filtered results.
- Logs in i3x and configdb both showing `Auth succeeded for [<your
  UUID>]` on the same request, proving forward-on-behalf-of works.
- 403 on a permission-denied thing, not 401, proving ACL ran on you
  rather than i3x's service principal.

If all four hold, the feature is verified end-to-end on the dev
cluster.
