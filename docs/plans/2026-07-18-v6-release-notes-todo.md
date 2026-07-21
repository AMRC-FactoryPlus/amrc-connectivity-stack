# v6.0.0 release notes - corrections still to apply

Status 2026-07-18: the release-notes audit workflow ran but only partly
succeeded. One of three audit agents returned solid, file:line-verified
findings (below). The other two returned stub/placeholder output and the
write + red-team phases died on API 529 overload. So the notes have NOT
been rewritten yet. These corrections still need applying to the
`## v6.0.0` section of `docs/reference/release-notes.md` before tagging
v6.0.0. All findings below were verified against code at HEAD vs tag
v5.1.0 and by local `helm template`.

## Corrections (verified)

- **Let's Encrypt cert omits the new hosts.** `deploy/templates/lets-encrypt/tls.yaml:26-41`
  lists 12 dnsNames plus `additionalDnsNames` (default `[]`,
  `deploy/values.yaml:17`). It does NOT cover `openid.<baseUrl>`,
  `i3x.<baseUrl>`, `data-access.<baseUrl>` (all new in v6), nor
  `files.<baseUrl>` / `influxdb.<baseUrl>` (already uncovered in v5.1.0).
  The notes must tell LE operators to add these to
  `acs.letsEncrypt.additionalDnsNames` or issuance/renewal silently
  skips them. (Does not affect internal-cert sites like ago/jahx.)

- **Grafana permissions instructions are wrong at the mechanism level.**
  Roles are F+ Permission OBJECTS surfaced via the `fp_permissions` JWT
  claim (`acs-service-setup/lib/grafana-permissions.js`,
  `deploy/templates/grafana/grafana-ini.yaml:33-36`), granted with
  target=Wildcard in the ACL editor - NOT group membership. The
  values.yaml comment at ~line 185-195 referencing "groups / fp_groups /
  lib/grafana-groups.js" is stale; no grafana-groups.js exists. Also:
  `acs-service-setup/dumps/admin.yaml:106` grants Grafana.Perm.Admin to
  ACS.Group.Administrator automatically, so Administrator-group members
  get Grafana Admin with no manual action.

- **Account continuity: rewrite the "may get a fresh Viewer account"
  warning.** PROVEN on jahx today: pre-existing v5 auth.proxy users are
  adopted into generic_oauth at first login with permissions retained
  across dashboards (the #677 fix: `email_attribute_path:
  preferred_username` + `oauth_allow_insecure_email_lookup` now in the
  `[auth]` section). State what happens rather than warning it might not.

- **Nanosecond timestamp failure mode is misstated.** Current notes say a
  v5 historian reading v6 ns timestamps stores points "tens of millions
  of years in the future". A JS `Date` caps at +/-8.64e15 ms; a ns epoch
  (~1.78e18) exceeds it, so `new Date(ns)` is Invalid Date, not a
  far-future point. The real failure is a loud write failure, not silent
  corruption. (Re-verify the exact end-to-end behaviour when writing.)

- **i3X does NOT hard-depend on Keycloak.** The note says don't disable
  openid while i3x is enabled; actually i3X degrades gracefully -
  `_helpers.tpl:82-96` sets `OIDC_DISCOVERY_URL=""` when openid is off
  and still honours Kerberos/Negotiate/Basic/opaque-Bearer. Soften the
  claim.

## New sections to add (draft paragraphs verified)

- **i3X authenticates but does not authorize.** Enabled by default,
  publishes `i3x.<baseUrl>`, authenticates every request (except public
  `/v1/info`) but has NO per-object ACL checks anywhere - any principal
  with a valid F+ token (including every edge agent keytab on a
  shop-floor device) can read the whole UNS, live and historic, plus the
  `/mcp` endpoint. Wider audience than v5, where MQTT/Influx ACLs gated
  it per principal. Disabling i3x also withdraws its Directory
  advertisement, leaving the admin UI Explorer page and Monitor live
  values without a data source.

- **service-setup Job is not a Helm hook.** `deploy/templates/service-setup.yaml:4-15`
  is a plain Job (backoffLimit 9999, OnFailure), no hook annotation, so
  `helm upgrade` returns success before any migration runs. Tell
  operators to watch the Job to completion; it can take minutes waiting
  on a first-boot Keycloak and retries until it succeeds.

- **Grafana emergency access on an upgraded cluster.** The v5
  grafana-admin-user Secret is preserved (`helm.sh/resource-policy:
  keep`), so the local admin stays `admin@<REALM>`, and on installs
  seeded before the password was randomised it is the built-in default
  `admin`. Treat as a live credential; break-glass needs the login form
  re-enabled first (`auth.disable_login_form: false` + pod restart).

## Also fold in (from this session, not the audit)

- Document `accessTokenLifespan` (from #680) alongside the
  `serviceAccountsEnabled` kiosk section - a kiosk needs BOTH or the wall
  still drops at the realm's 300s default.
- Add the ordered upgrade procedure at the top: snapshot Grafana PV AND
  shared Postgres (Directory v13 is one-way; rollback crash-loops both
  directory pods; repair is `update version set version = 12;` in the
  directory DB), watch the service-setup Job, verify Grafana login +
  playlists present (`rejected=0` in the Grafana log's Count validation
  line) + run ISA-95 Import from Devices.
- Confirmed CORRECT, no change needed: ConfigDB WriteSuperclasses change,
  Files ReadMembers, v1-dump removal (HTTP 422), Directory v13,
  service-registration-in-chart, MetaDB disabled.
