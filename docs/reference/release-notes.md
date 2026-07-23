# Release Notes

This documents important user-visible changes to ACS, in reverse
chronological order.

## Current development

These changes have not been released yet, but are likely to appear in
the next release.

### Keycloak upgraded from 26.1 to 26.6

The bundled Keycloak moves to 26.6.3, primarily for its PostgreSQL
JDBC driver (42.7.11): the 42.7.4 driver shipped with Keycloak 26.1
has a bug (pgjdbc #3373) where the GSS-encrypted database stream is
corrupted by partial TCP reads, crashing Keycloak with "Could not use
AES128 Cipher - Checksum failed" under network conditions that split
GSS tokens across reads. Seen in production; the trigger is
environmental (TCP segmentation behaviour), so any site can hit it.

Keycloak migrates its database schema one-way on first start of the
new version; downgrading afterwards requires a database restore. The
F+ SPI is rebuilt against 26.6 (no source changes needed) and the
chart now uses the KC_BOOTSTRAP_ADMIN environment variables in place
of the KEYCLOAK_ADMIN ones deprecated in Keycloak 26 (only consulted
when the master realm has no admin, so inert on established sites).
Keycloak 26.2-26.6 also tightens some token-endpoint behaviour
(introspection audience checks, userinfo with lightweight tokens);
none of it affects the flows ACS provisions, but sites with custom
OIDC clients should skim the upstream migration notes.

## v6.1.3

### ACL editor shows identity-less principals

The admin UI's principal list now includes principals without a
kerberos/sparkplug identity, shown with a "No identity" placeholder.
In particular the F+ principals created for OIDC service accounts
(v6.1.1) can now be granted permissions through the standard editor,
so setting up an unattended visualiser wall no longer requires the
Auth API directly.

## v6.1.2

### service-setup survives duplicate Keycloak protocol mappers

A Keycloak client holding two same-name protocol mappers (possible
when two service-setup jobs race, since Keycloak does not enforce
name uniqueness on create) failed every subsequent client update
with a 500, permanently bricking service-setup. Client updates no
longer echo the mapper list, and duplicate F+ mappers are deleted
automatically on the next run.

## v6.1.1

### Service-account OIDC clients get Factory+ principals

Each `serviceAccountsEnabled` OIDC client now gets an F+ Principal
("Service account: <name>" in the ACL editor), and its
client-credentials tokens carry `fp_principal_uuid`, so unattended
consumers (visualiser walls, scheduled jobs) can be granted F+
permissions like any other principal and can authenticate to the F+
HTTP services and the MQTT broker. Previously such tokens were
rejected by the HTTP services and received an empty MQTT ACL. A fresh
service account holds no grants; grant its principal the permissions
it needs (e.g. MQTT read for a wall) via the ACL editor.

## v6.1.0

This release moves the visualiser onto the central Keycloak login and
teaches the MQTT broker to accept JWTs. There are no breaking changes;
upgrading from v6.0.x is a plain `helm upgrade`.

### Visualiser logs in through Keycloak

The visualiser no longer shows its own username/password form on
cluster deployments. Opening it redirects to the Keycloak login page
(sharing the SSO session with Grafana and anything else on the realm)
and returns with a JWT, which is used for the Directory, ConfigDB and
the MQTT websocket connection. Tokens are refreshed automatically
before expiry, so a tab left open stays live. Pressing Escape logs out
through Keycloak's end-session endpoint.

The chart provisions a public `visualiser` OIDC client (PKCE S256)
automatically via service-setup. The old form remains only as a
fallback when `OIDC_DISCOVERY_URL` is not configured (local
development).

### Visualiser kiosk URL login

For unattended displays the visualiser accepts
`?auth_token=<JWT>` in the URL, matching Grafana's `url_login`, and
strips the token from the address bar immediately. No refresh happens
in this mode: mint kiosk tokens from a service-account
(client-credentials) OIDC client with a long `accessTokenLifespan`
(see `serviceSetup.config.openidClients` in values.yaml), the same
pattern used for Grafana kiosk walls.

### The MQTT broker accepts JWTs as passwords

The HiveMQ auth plugin now recognises a Keycloak JWT presented as the
MQTT password (any username; identity comes from the verified token's
`preferred_username`). Verification uses the realm's JWKS via
`OIDC_DISCOVERY_URL`, mirroring the HTTP services, and the normal MQTT
ACL lookup runs on the token's principal. Kerberos passwords and
GSSAPI are unaffected; the JWT path only engages when the password is
shaped like a JWT and openid is enabled.

## v6.0.0

This is a major release. It changes the Sparkplug timestamp format, the
way users log in to Grafana, the bundled Grafana version, and two
ConfigDB permissions. None of these are backwards compatible, and
several of the Grafana and Directory changes are one-way. Please read
this whole section before upgrading a production installation.

Note that v4 and v5 were not documented here; this section describes the
changes from v5.1.0.

### Upgrade procedure

The detail is in the sections below; this is the order to work in.

1. **Before you start**, add DNS records for the three new external
   hosts (`openid`, `i3x`, `data-access`) and make sure your TLS
   certificate covers them. The chart's Let's Encrypt certificate
   includes each of these hosts automatically while its service is
   enabled, so create the DNS records **before** upgrading: a name on
   the certificate that does not resolve fails the HTTP-01 challenge and
   blocks issuance and renewal of the whole certificate. If you disable
   a service, its host is left off the certificate and needs no record.
   The certificate now also covers `files.<baseUrl>` and
   `influxdb.<baseUrl>`, which were served in v5 but missing from the
   certificate; a Let's Encrypt site without DNS records for those two
   must add them before upgrading, for the same reason. A wildcard or
   externally-managed certificate needs nothing.
2. **Snapshot two persistent volumes.** The Grafana volume, because the
   dashboard and playlist migrations are one-way and cannot be rolled
   back. And the shared Postgres volume, because the Directory database
   migrates to a new schema version on first start of a v6 Directory
   pod, and a v5 Directory pod will not start against it - a rollback
   without the snapshot leaves both Directory pods in CrashLoopBackOff.
   (If you are caught in that state, the minimal repair is
   `update version set version = 12;` in the `directory` database.)
3. **Run `helm upgrade`, then watch the `service-setup` Job.** It is a
   plain Kubernetes Job, not a Helm hook, so `helm upgrade` reports
   success before the Job has done any work. The permission grants,
   the Keycloak realm and client provisioning, and the service
   registrations all happen inside it. On a cluster whose Keycloak is
   starting for the first time the Job can take several minutes while it
   waits for Keycloak to become ready, and it retries until it succeeds,
   so a Job that has not yet completed is not necessarily failing. Wait
   for it to complete before relying on the upgrade.
4. **After it completes**, confirm the Grafana migrations before you
   rely on the install or upgrade the edge agents. A playlist that fails
   to migrate is recorded as done and never retried, and the ones that
   did migrate still render, so looking at the playlist list in the UI
   will not tell you a playlist is missing. Instead check the Grafana
   log for the `Count validation` line on `playlists.playlist.grafana.app`
   and confirm `rejected=0` with `legacy_count` equal to `unified_count`.
   If `rejected` is not zero, restore the Grafana volume snapshot, fix
   the offending playlists, and upgrade again. Then sign in to confirm
   your dashboards are present, and run **Import from Devices** on the
   ISA-95 page if you have existing hierarchy values.
5. **Upgrade the edge agents last**, once the central services are on
   v6 (see the timestamp section).

### Nanosecond timestamps: upgrade central services before edge agents

Sparkplug payload and metric timestamps now hold **nanoseconds** since
the epoch, in the same `uint64` field that previously held milliseconds.
The UNS JSON `timestamp` field is likewise now an ISO-8601 string with
nanosecond precision, for example `2026-05-28T15:46:56.100923659Z`
rather than `2026-05-28T15:46:56.100Z`.

Components from this release read a timestamp below 1e15 as milliseconds
and convert it, so a v6 central service can consume data from a v5 edge
agent. **The reverse is not true.** A v5 historian reading from a v6
edge agent treats the nanosecond value as milliseconds; the number is
far larger than any date the historian can represent, so it becomes an
invalid time and those points are not stored rather than being written
with a wrong timestamp. Either way the data is lost until both ends are
on v6, so upgrade the central services first and the edge agents last.

Edge agents are upgraded by the edge Helm charts, which you control, so
the ordering is yours to enforce: do not roll an edge cluster to v6
until its central services are on v6.

Two further consequences:

- The Sparkplug B specification defines this field as milliseconds. Any
  external, non-ACS consumer that reads ACS Sparkplug payloads directly
  will misinterpret the new values, and any consumer of the UNS topics
  with a strict RFC 3339 parser may reject the extra digits of
  precision.
- Existing InfluxDB data is unaffected and needs no migration. Both
  historians already wrote at nanosecond precision, so stored timestamps
  and measurement names are unchanged.

### Grafana now authenticates through Keycloak

Previously Grafana sat behind a Traefik `basic-auth` middleware and
trusted a proxied header (`auth.proxy`). This release deploys Keycloak
as an OIDC provider and Grafana authenticates against it. The
`grafana.grafana.ini.auth.proxy` values have been removed, and Grafana's
own login form is hidden: users sign in via a "Factory+" SSO button.

Keycloak itself validates credentials against Kerberos, and Kerberos
authentication is otherwise unchanged. Edge agents, the Manager and the
other central services continue to authenticate exactly as they did.

On upgrade you must:

- Create a DNS record for the new `openid.<acs.baseUrl>` host and ensure
  the certificate Grafana's browser is served covers it. The chart's
  Let's Encrypt certificate includes the host automatically while
  `openid` is enabled, so the record must exist before the upgrade (see
  the upgrade procedure). The Keycloak discovery endpoint
  must also resolve and present a valid certificate *from inside the
  cluster*, because the `service-setup` Job calls it there; a split-horizon
  DNS setup that only answers externally will wedge the Job.
- Grant Grafana roles through Factory+ permissions. Roles are no longer
  held in Grafana. The two roles are Factory+ permissions listed under
  `serviceSetup.config.grafanaPermissions` (Grafana Admin and Grafana
  Editor); grant one to a principal with the Factory+ ACL editor, using
  the wildcard target, and it arrives in the `fp_permissions` claim on
  the principal's next login. Anyone without a grant is a Viewer, and
  revoking a grant demotes the user at their next login. The maximum role
  is Admin; Grafana's server-admin (GrafanaAdmin) is no longer assigned.
  Members of the **Administrator** group get Grafana Admin automatically
  through the shipped ACLs, so an operator who is already an
  Administrator needs no further action.
- Existing Grafana accounts are reclaimed automatically. Federated logins
  arrive with the Kerberos UPN as the username, which is the same string
  the v5 proxy login used, and Grafana matches the returning user to
  their existing account and keeps their dashboards and role. (This
  relies on `oauth_allow_insecure_email_lookup`, which the chart sets;
  the "insecure" here only means Grafana trusts the email the identity
  provider asserts, and that provider is your own Keycloak backed by
  Kerberos.) The one account that may not reclaim cleanly is the local
  emergency admin: see below.

The Keycloak deployment uses the custom `acs-keycloak` image, which has
the Factory+ storage provider built in. Stock upstream Keycloak will not
work. The Keycloak admin password, the client secrets and the Keycloak
database are all created automatically; there is no manual realm or
client configuration to do.

Setting `openid.enabled` to `false` will skip Keycloak, but Grafana then
has no interactive login at all. Hiding the login form does not leave a
back door: Grafana does not register the password login client when
`auth.disable_login_form` is set, so the local admin account cannot sign
in interactively or over the API, and there is no query parameter that
re-enables the form. To recover access, put the form back with a values
override and restart the Grafana pod:

```yaml
grafana:
  grafana.ini:
    auth:
      disable_login_form: false
```

On a cluster upgraded from v5, the `grafana-admin-user` Secret from your
v5 installation is kept (it carries `helm.sh/resource-policy: keep`), so
the local admin is still `admin@<REALM>`. On installations first seeded
before the admin password was randomised, that account's password is
Grafana's built-in default `admin`, not the random value a fresh v6
install generates. Treat it as a live credential: it is the account you
would use with the break-glass override above, and its password should
be rotated. Whether signing the admin principal in through SSO adopts
this local account was not verified during the upgrade testing, so do
not rely on SSO to reclaim it; keep it as a local login reached through
the break-glass override.

### Grafana upgraded from v10 to v12

The bundled Grafana image moves from 10.0.1 to 12.4.5. Grafana 10.x
left support in 2024, so this catches up two majors of security fixes,
and the newer `auth.jwt` support is what lets machine-to-machine
consumers sign in with tokens (see below).

This release deliberately stops at 12.4.x rather than 13.x. Grafana 13
removed the schema migration that adds the `playlist.created_at` and
`updated_at` columns, which were introduced in 10.2.0, while still
running a playlist migration that requires them. A database created by
the Grafana 10.0.1 that ACS v5.1.0 shipped therefore cannot start under
Grafana 13 at all. Grafana 12.4.x still ships that migration, so it
adds the columns and completes the playlist migration itself; a later
move to 13 will then be safe.

Three upstream Grafana changes are worth knowing about when upgrading
an existing installation:

- Your playlists and dashboards are migrated into Grafana's unified
  storage on first boot, and the migration is one-way: once the new
  image has written to the Grafana database you cannot return to the
  previous one. This is why the upgrade procedure has you snapshot the
  Grafana volume first. Check after upgrading that the playlists you
  expect are all present before you rely on the installation. The
  playlist migration logs a warning and carries on rather than failing
  if it rejects an individual playlist, so a clean run is not enough on
  its own - confirm the Grafana log shows a `Count validation` line for
  `playlists.playlist.grafana.app` with `rejected=0` and
  `legacy_count` equal to `unified_count`. A non-zero `rejected` means
  some playlists did not migrate and, because the migration then records
  itself as done, will not be retried; restore the volume snapshot,
  correct the offending playlists, and upgrade again.
- The chart keeps folders and dashboards on Grafana's legacy storage by
  pinning `autoMigrationThreshold` to 1 for both. Grafana 12 otherwise
  auto-migrates them into unified storage on any installation with fewer
  than ten dashboards, so without the pin a small site would silently
  take that one-way migration while a large one would not. There is no
  action for you here unless you override those values; do not.
- Support for AngularJS plugins has been removed (disabled by default
  in Grafana 11, gone entirely in 12). Grafana's built-in panels are
  unaffected and legacy Graph/Table panels are migrated automatically,
  but any third-party Angular panel or data source plugin will no
  longer render. Audit your dashboards for these before upgrading.
- Links that deep-link a single panel changed format in Grafana 11
  (`?viewPanel=5` became `?viewPanel=panel-5-…`), so bookmarks and
  kiosk URLs pointing at individual panels need re-copying from the new
  UI. Links to whole dashboards, including kiosk-mode links, are
  unchanged.

Also removed upstream, though ACS does not deploy either: the image
renderer plugin and legacy alerting. If you added one of those to your
own installation, migrate off it before upgrading.

### Machine-to-machine OIDC clients

Clients declared under `serviceSetup.config.openidClients` may now set
`serviceAccountsEnabled: true`, which turns on the OAuth
client-credentials grant so an unattended consumer, such as a display
wall or a scheduled job, can exchange its generated client secret for a
token without a human login. Such a client should normally also set
`standardFlowEnabled: false`, as it has no browser session to redirect.
Keycloak only supports service accounts on confidential clients, so the
flag is ignored on a client marked `publicClient`.

A client may also set `accessTokenLifespan` (in seconds) to override the
realm's access-token lifespan, which defaults to 300 seconds, for that
one client. This matters for an unattended display: a wall that signs a
Grafana panel in with a token (Grafana's `auth.jwt` `url_login`) holds
no session and re-presents the same token on every request, so it stops
working the moment the token expires and drops to a login screen. Give
such a client a long-lived token - for example `2592000` for thirty days
- and let the consumer refresh it before expiry. A kiosk needs both
`serviceAccountsEnabled` and `accessTokenLifespan`; the service account
alone still expires at the realm default. Leaving `accessTokenLifespan`
unset keeps the realm lifespan, so nothing changes for clients where a
human signs in.

If such a client reaches Keycloak's JWKS endpoint over plain HTTP -
which happens with Grafana's `auth.jwt` on a cluster deployed with
`acs.secure: false` - Grafana will not fetch the signing keys over HTTP
and exits at startup with `jwt_set_url must have https scheme`. Running
it in development mode (`GF_DEFAULT_APP_MODE: development`) lifts that
restriction. A production deployment serves HTTPS and needs neither the
override nor that concern.

These settings are off unless asked for, and existing clients are
unaffected.

### Two new services are exposed by default

`i3x` and `data-access` are both enabled by default, and each publishes
an external host: `i3x.<acs.baseUrl>` and `data-access.<acs.baseUrl>`.
Add DNS records and ensure your TLS certificate covers them, or set
`i3x.enabled` or `dataAccess.enabled` to `false`. The chart's Let's
Encrypt certificate includes each host automatically while its service
is enabled, which is why the DNS records must exist before you upgrade;
a disabled service's host is left off the certificate. These services
use only cluster-internal URLs at runtime, so a missing DNS record or
an uncovered host does not stop them running; it stops the Manager's
Explorer page and the browser-facing API from reaching them.

### i3X authenticates every request but does not authorize per object

i3X is enabled by default and serves the entire Unified Namespace, live
values and history, over `i3x.<acs.baseUrl>`. It authenticates every
request - a call with no valid Factory+ credential is refused, apart
from the public `/v1/info` endpoint - but it performs no per-object
authorization. Any principal that can obtain a Factory+ token can read
the whole namespace through i3X, and that includes every edge agent
service account whose keytab sits on a shop-floor device. This is a
wider audience than in v5, where the same data was gated per principal
by the MQTT and InfluxDB ACLs. The same authentication-only gate covers
the `/mcp` endpoint, which exposes the namespace to an MCP client.

If that exposure is not acceptable for your site, set `i3x.enabled` to
`false`. Doing so also withdraws i3X's advertisement from the Directory,
which leaves the Explorer page and the live values in the Manager's
Monitor view without a data source, since both read from i3X.

i3X does not hard-depend on Keycloak. With `openid` disabled it still
accepts Kerberos and the other Factory+ credential types and simply
stops accepting OIDC bearer tokens, so disabling `openid` degrades i3X
rather than breaking it.

### ConfigDB permission changes

Adding a subclass relationship now requires the `WriteSuperclasses`
permission on the target class, where previously `ReadSubclasses` was
enough. The accounts shipped with ACS are updated automatically, but
**any local principal that creates subclasses must be granted the new
permission**, otherwise those writes will start returning 403.

The Files service now also requires `ReadMembers` on the file class,
without which file operations fail with permission errors.

Both grants are applied by the service-setup Job, which runs
automatically as part of `helm upgrade`.

### ConfigDB version 1 dumps are no longer accepted

Support for the version 1 dump format has been removed. Any dumps you
maintain outside this repository must be converted to version 2.

### Service registration has moved into the Helm chart

Service URLs used to be registered from a fixed dump baked into the
service-setup image. They are now generated by the chart and gated on
each service's `enabled` flag, so only the services you actually deploy
are advertised in the Directory. No change to your values file is
needed, and no stale registrations need clearing out. The Directory
database picks up a new schema version automatically on startup, which
makes the `device` column of a service advertisement optional.

### The ISA-95 hierarchy is now a controlled vocabulary

The five ISA-95 levels (Enterprise, Site, Area, Work Centre, Work Unit)
are no longer free-text fields on a device. They are selected from a
vocabulary of ConfigDB objects, which prevents the inconsistent spelling
of site and area names that free text allowed.

The vocabulary is managed from the new **ISA-95** page in the Manager,
where hierarchy nodes can be created, renamed, given alternative names
(aliases) and pruned. A node cannot be deleted while it still has
children, so a hierarchy is dismantled from the bottom up rather than
leaving orphaned nodes behind.

Nothing seeds the vocabulary automatically: the bundled dump creates
only the five level classes and the vocabulary application. Until nodes
exist, the hierarchy dropdowns on a device are empty and the hierarchy
cannot be set.

**If you are upgrading an installation that already has hierarchy values
typed against its devices,** use "Import from Devices" on the ISA-95
page rather than retyping them. This reads the values already saved on
every device, shows you what it proposes to create, and builds the
vocabulary to match. Names that differ only in case or spelling from an
existing node are attached to that node as aliases, so a device keeps
resolving against the vocabulary without being edited. Devices are never
modified by the import. Values that sit below a missing level (an Area
on a device with no Site, say) cannot be placed in the tree; they are
reported and left alone.

The import is deliberately a manual action rather than something that
runs on upgrade. Nodes are derived from device values, which the import
does not rewrite, so a migration that ran automatically would recreate
any node you had pruned every time the chart was upgraded. Run it when
you choose to, prune what you do not want, and the result stays as you
left it. You can run it again at any time to pick up devices added
later.

CSV import ignores the ISA-95 columns for the same reason the metric
tree hides them. They are still present in an exported CSV, but editing
them and re-importing will not change the hierarchy; use the ISA-95
Hierarchy panel on the device, or the ISA-95 page, instead.

### MetaDB is present but disabled

This release includes the first parts of the MetaDB, an RDF-backed
reimplementation of the ConfigDB. It ships disabled and its integration
is not yet complete, so it should not be enabled on a production
installation. Turning on `metadb.asConfigDB` repoints the Directory's
ConfigDB advertisement at the MetaDB and requires `configdb.enabled` to
be `false`; there is no migration of existing ConfigDB content into it.

## v3.4.0

### Unified Namespace & Historian
This release of ACS enables a true Unified Namespace (UNS). The UNS is a
single point of truth for all data collected by ACS in human-readable
format. The UNS is "fed" by ingesters, which take channels of data (in
this case, Sparkplug), and publishes the human-readable content to
`UNS/v1`. In the future additional ingesters may be added to ACS.

In addition to the Sparkplug ingester, this release features a UNS 
historian, which persists the UNS data to the same InfluxDB 
database used by the legacy Sparkplug historian. **By default, the 
UNS historian is disabled** in an effort to minimise the impact of
this change on existing installations. To enable the UNS historian,
set the `historians.uns.enabled` environment variable to `true`. If 
you only want to exclusively persist UNS data (and not legacy 
Sparkplug data) then set `historians.sparkplug.enabled` to `false`.

## v3.1.0

### Administration interface
A new administration interface has been added to ACS, which will slowly
become the single-point-of-contact for all administrators and managers
of ACS installations. Currently this interface only exposes the new
alerts system, but will be expanded in future releases. It can be
accessed from the base URL of your ACS installation. 

### Global admin account changes

The 'Global Administrator Account' user account is now created with a
UUID specific to this installation of ACS. Once this has been done the
old account object (`d53f476a-29dd-4d79-b614-5b7fe9bc8acf`) can be
deleted.

The password for this account has moved from the `krb5-passwords` K8s
Secret into a dedicated Secret for this purpose, `admin-password`. This
contains a single key `password` holding the account password.

Note that this account bypasses all ACLs and should not be used for
normal operation.

### Removed client roles

Previously ACS deployed a Client Role called 'Global Debugger'
(`4473fe9c-05b0-42cc-ad8c-8e05f6d0ca86`). This was
a Group of permissions within the Auth service which was granted in the
`permission` slot of access control entries. It was only useful if
granted with a wildcard `target`.

This has been replaced by a Group of users called 'MQTT global
debuggers' (`f76f8445-ce78-41c5-90ec-5964fb0cd431`). Accounts and groups
which should have global MQTT access should be added to this group; the
group should not appear in any additional access control entries.

Accounts created by the ACS installation will have been updated to be
members of the Group, but ACLs referencing the Client Role and the Role
itself will not have been removed. Any local accounts using the Role
should be updated to be members of the Group instead, and then any
access control entries referencing the Role (and the role itself)
should be removed.

### TLS certificate namespace
IngressRoutes are now namespaced to the namespace of the chart release.
Previously they were namespaced to the `default` namespace. This means
that if you are providing your own wildcard TLS certificate you will
need to ensure that it is moved from the `default` namespace to the
namespace of the ACS release, otherwise Traefik will serve the default
certificate instead.

## v3.0.0

This is a major release, with fundamental changes to the architecture.
[Detailed release notes are available
here.](../getting-started/whats-new-in-v3.md)
