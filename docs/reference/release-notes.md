# Release Notes

This documents important user-visible changes to ACS, in reverse
chronological order.

## Current development

These changes have not been released yet, but are likely to appear in
the next release.

## v6.0.0

This is a major release. It changes the Sparkplug timestamp format, the
way users log in to Grafana, and two ConfigDB permissions. None of these
are backwards compatible. Please read this whole section before
upgrading a production installation.

Note that v4 and v5 were not documented here; this section describes the
changes from v5.1.0.

### Nanosecond timestamps: upgrade central services before edge agents

Sparkplug payload and metric timestamps now hold **nanoseconds** since
the epoch, in the same `uint64` field that previously held milliseconds.
The UNS JSON `timestamp` field is likewise now an ISO-8601 string with
nanosecond precision, for example `2026-05-28T15:46:56.100923659Z`
rather than `2026-05-28T15:46:56.100Z`.

Components from this release read a timestamp below 1e15 as milliseconds
and convert it, so a v6 central service can consume data from a v5 edge
agent. **The reverse is not true.** A v5 historian reading from a v6
edge agent will interpret a nanosecond value as milliseconds and store
points dated tens of millions of years in the future. Upgrade the
central services first, then the edge agents.

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
  your TLS certificate covers it.
- Grant Grafana roles through Factory+ permissions. Roles are no longer
  held in Grafana. Add principals to the groups listed under
  `serviceSetup.config.grafanaPermissions`; anyone without a grant
  becomes a Viewer, and revoking a grant demotes the user at their next
  login. The maximum role is now Admin, as Grafana Admin is no longer
  assigned.
- Check that your existing Grafana users can still reach their accounts.
  Dashboards and the Grafana database are preserved across the upgrade,
  but federated logins now arrive with the Kerberos UPN as their
  username. Where that differs from the username a v5 proxy login
  created, the user may be given a fresh Viewer account instead of
  reclaiming the old one.

The Keycloak deployment uses the custom `acs-keycloak` image, which has
the Factory+ storage provider built in. Stock upstream Keycloak will not
work. The Keycloak admin password, the client secrets and the Keycloak
database are all created automatically; there is no manual realm or
client configuration to do.

Setting `openid.enabled` to `false` will skip Keycloak, but Grafana then
has no interactive login other than the local emergency admin account,
which remains reachable at `/login?disableLoginForm=false`.

### Machine-to-machine OIDC clients

Clients declared under `serviceSetup.config.openidClients` may now set
`serviceAccountsEnabled: true`, which turns on the OAuth
client-credentials grant so an unattended consumer, such as a display
wall or a scheduled job, can exchange its generated client secret for a
token without a human login. Such a client should normally also set
`standardFlowEnabled: false`, as it has no browser session to redirect.
Keycloak only supports service accounts on confidential clients, so the
flag is ignored on a client marked `publicClient`.

This is off unless asked for, and existing clients are unaffected.

### Two new services are exposed by default

`i3x` and `data-access` are both enabled by default, and each publishes
an external host: `i3x.<acs.baseUrl>` and `data-access.<acs.baseUrl>`.
Add DNS records and extend your TLS certificate to cover them, or set
`i3x.enabled` or `dataAccess.enabled` to `false`. The i3X service
depends on Keycloak, so do not disable `openid` while leaving `i3x`
enabled.

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
