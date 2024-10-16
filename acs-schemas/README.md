# ACS schemas

This directory holds the ACS standard set of schemas. It also holds code
to build an image to load these schemas into the ConfigDB; this is run
as part of acs-service-setup to ensure an ACS installation has the
schemas available.

## Structure

The schemas themselves live under `schemas`. The following conventions
must be observed for the install process to work correctly:

* Schemas are JSON schema, expressed as YAML for readability.
* The schemas are not applied to JSON, they are applied to Sparkplug
  Metrics. Only certain features of JSON Schema will work correctly.
  These are not documented; don't stray too far from the examples
  already here.
* Each schema must be in a file `Foo/Bar-vN.yaml`. This identifies the
  schema as version `N` of the `Foo/Bar` schema.
* Each schema needs to be assigned a UUID. A new version of a schema
  needs a new UUID.
* The schema's `$id` must be of the form `urn:uuid:UUID` where `UUID` is
  the assigned UUID. The schema must also require a `Schema_UUID` metric
  at its top level with `UUID` as its value.

Schemas under `private` are private schemas belonging to the Manager
which are in this repo for historical reasons. If more are needed they
should be assigned UUIDs; private schemas need the same `urn:uuid:UUID`
format for `$id` and additionally should have a meaningful `title`.
