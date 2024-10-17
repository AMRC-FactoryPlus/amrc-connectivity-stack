# Release Notes

This documents important user-visible changes to ACS, in reverse
chronological order.

## Current development

These changes have not been released yet, but are likely to appear in
the next release.

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
here.](./docs/whats-changed-in-v3.md)
