# ACS dump files

This directory contains service dump files loaded into the services by
service-setup. This should be the normal way to load configuration into
the services on ACS install.

The files in this directory are YAML and each file can contain multiple
dumps separated by `---` lines as usual in YAML. The YAML is converted
to JSON by the code in `lib/dumps.js` and loaded into the services. Each
document must be an object at the top level with at least the keys
`service` and `version`; these identify the service to load the dump
into and the version of the dump format used. Currently acceptable
versions are:

* ConfigDB: 1 or 2. Version 1 cannot define higher-rank classes.
* Auth: 2. Version 1 cannot be loaded into the current Auth service.
* Directory: 1.

The YAML loader implements certain features over and above plain
translation to JSON in order to make it easier to maintain the dumps.

## YAML tags

Tags are a YAML feature which allow new datatypes and new data
representations to be defined. A tagged value begins with tag which
starts with `!`. The loader makes use of tags to simplify the loading
process and make the dumps more comprehensible.

### `!u`: Well-known UUIDs

The tag `!u` access the list of well-known UUIDs. The tag must be
followed by a a dot-separated string (like a JS object access), e.g.

    !u UUIDs.Service.ConfigDB

The tag resolves to a JSON string containing a UUID and makes it
possible to reference well-known UUIDs by name. There are three sources
of UUIDs:

* Values under `UUIDs` come from `@amrc-factoryplus/service-client`.
* Values under `Local` refer to locally-created objects; see below.
* All other values come from `lib/uuids.js` in this service.

An unknown UUID will raise an exception when the file is loaded.

### `!acs`: ACS config information

The tag `!acs` accesses the information from the `ACS_CONFIG`
environment variable passed to service-setup. The tag must be followed
by a string; expressions of the form `${key}` within this string will be
expanded from the properties in `ACS_CONFIG`. For example

    !acs "http://directory.${namespace}.svc.${k8sdomain}"

will give an internal URL for the Directory.

## Load ordering

The loader understand certain keywords in YAML comments to indicate the
order in which files should be loaded. ConfigDB version 2 dumps require
the objects used as primary classes to exist before the dump is loaded
so it can be necessary to control the order of loading. There are two
phases of dump loading: the early phase is the first thing service-setup
does and needs to register services with the Directory and create
essential classes; the late phase happens after local UUID generation
and ACS upgrade fixups.

These comments will be recognised anywhere but should be kept at the top
of the file for clarity. Keywords are all caps and are only recognised
following `#-` at the start of a line to avoid false positives.

### REQUIRE

This keyword indicates this file must be loaded after another file. The
comment must look like this:

    #-REQUIRE: auth sparkplug

with a list of filenames after the keyword. Filenames are names of files
in this directory without the `.yaml` extension.

### EARLY

This keyword indicates this file should be run as part of the early
phase. All dumps in this phase which are not for the Directory must have
a `REQUIRE` keyword depending on `service-urls`, which registers the
other services.

## Linting

There is a lint script in `bin/check-yaml.js`; this can be run with
`make lint` or `node bin/check-yaml.js` from the acs-service-setup
directory. If this fails you may need to run `make setup` or `npm
install`.

This will check YAML syntax on all files and verify that the YAML tags
are used correctly. Note that `Local` UUIDs cannot be validated as we
don't know which UUIDs should exist. The lint step will also load
compiled schemas for the dump files from the service source directories
(`../acs-config` and so on) so it can validate the dump schema.
