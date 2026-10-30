# Briefcase exporter

The briefcase exporter (`acs-briefcase`) packages datasets for sharing
outside Factory+. When a dataset is added to the `Published` class, the
exporter builds a **briefcase** of it: one zip holding the dataset's
telemetry, a description of each device and of the dataset, and the
terms it is released under. It stores the zip in the Files service and
records it against the dataset. Removing the dataset from `Published`
withdraws the briefcase.

A briefcase never changes once it is released. Publishing a withdrawn
dataset again builds a new briefcase, with a new UUID, which names the
one it replaces.

The exporter has no HTTP API. It is a worker that watches ConfigDB, and
the chart runs it only when `briefcase.enabled` is set.

## Releasing a dataset

1. Give the dataset a `Release policy` entry (below). The exporter will
   not build a briefcase without one, or for a dataset with no start and
   end time.
2. Add the dataset to `Published`. This is the release decision.
3. The exporter builds the briefcase, uploads it to Files as a
   `Briefcase` file, and adds it to the dataset's `Briefcase release`
   entry.
4. A releaser downloads the briefcase and passes it on.

To withdraw a dataset, remove it from `Published`. The exporter stamps
the withdrawal time on the live briefcase and keeps the zip in Files as
a record of what left. Copies already passed on are not recalled. To
correct a released dataset, withdraw it and publish it again.

The Admin UI's **Release** tab on the dataset page does all of this: it
edits the release policy, releases and withdraws the dataset (asking why
when it withdraws), and lists every briefcase with a download.

## How the exporter works

The exporter compares the members of `Published` with the `Briefcase
release` entries, and re-plans whenever either changes:

* A Published dataset with no live briefcase needs one built.
* A live briefcase whose dataset is no longer Published needs
  withdrawing.

Comparing the two, rather than reacting to each change, means a restart
or a missed notification cannot lose work. It does the work one dataset
at a time, withdrawals first.

A briefcase UUID is minted at the first build attempt. A failed build is
retried after `RETRY_INTERVAL` seconds under the same UUID. Once a
briefcase is recorded, its UUID is never used again. The exporter
re-reads a dataset's entry before each build, and remembers work it has
done until ConfigDB reports it, so it does not build a dataset twice.

The chart runs one replica with the `Recreate` strategy, so two
exporters never run at once.

## Briefcase format

A briefcase is a [BagIt](https://www.rfc-editor.org/rfc/rfc8493) bag,
zipped under a single top-level directory named after the briefcase,
with an [RO-Crate 1.3](https://www.researchobject.org/ro-crate/specification/1.3/)
in the bag's `data/` directory. The BagIt manifest therefore covers
every file the researcher reads.

```
briefcase-<uuid>/
├── bagit.txt, bag-info.txt
├── manifest-sha256.txt, tagmanifest-sha256.txt
└── data/
    ├── ro-crate-metadata.json
    ├── policy.json
    ├── metadata/
    │   ├── dataset.json
    │   └── devices/<device-uuid>.json
    └── telemetry/
        ├── csv/<device-uuid>.csv
        └── parquet/<device-uuid>.parquet
```

File | Content
---|---
`telemetry/csv/<device-uuid>.csv` | Every data point from one device, one per row. This is the canonical copy.
`telemetry/parquet/<device-uuid>.parquet` | The same rows as the CSV, in the same order, as Parquet. Built from the CSV file, so the two cannot disagree.
`metadata/dataset.json` | The dataset's name, `from` and `to`, tags, and its run's description and reference.
`metadata/devices/<device-uuid>.json` | The device's name and schema, its objects with their schemas and instances, and each metric recorded to the historian with its type, unit and documentation.
`policy.json` | The dataset's release policy.
`ro-crate-metadata.json` | Describes the briefcase and every file in it.

The CSV columns are:

Column | Content
---|---
`timestamp` | UTC, RFC 3339, always with nine fractional digits: InfluxDB drops trailing zeros, the exporter puts them back
`metric` | The full Sparkplug metric name, with its folders
`type` | `double`, `int`, `uint`, `boolean` or `string`
`value` | The value exactly as InfluxDB returned it
`unit` | The engineering unit, empty if there is none

The Parquet columns are `timestamp` (`TIMESTAMP(isAdjustedToUTC=true,
MICROS)`, truncated to the microsecond), `timestamp_ns` (`INT64`, the
exact time in nanoseconds since the epoch), `metric`, `type`, `unit`,
and one nullable value column per type: `value_double`, `value_int`,
`value_uint` (`INT64` with the `UINT_64` converted type), `value_boolean`
and `value_string`. Each row sets only the column its `type` names. The
files use zstd compression and row groups of 100,000 rows.

In the RO-Crate, each device is an `IndividualProduct`. Each telemetry
and device file says which device it is `about`, and each telemetry
file gives the time range it covers. The
briefcase's identifier is a `PropertyValue` holding its UUID. A
briefcase that replaces a withdrawn one says so with Dublin Core's
`replaces` (`http://purl.org/dc/terms/replaces`), added to the
`@context`, pointing at `urn:uuid:<withdrawn briefcase>`.

### What is left out

Only the fields above leave Factory+. In particular a briefcase never
contains:

* Factory+ principals, account names or permissions. The data owner is
  an organisation and a contact from the release policy.
* The rest of the run metadata: who created or ran a recording, notes,
  and MES identifiers.
* Device connection details, such as protocol addresses, from the
  origin map.
* The dataset's internal structure definition.

## ConfigDB objects

`acs-service-setup/dumps/briefcase.yaml` creates these, except
`Published` and `Release policy`, which are in `data-access.yaml`.

Kind | Name | UUID
---|---|---
Class | `Published dataset` | `414d2d10-6be8-4c27-8e9f-c716ef5432b9`
Application | `Release policy` (a member of `Dataset metadata`) | `cb9b2307-3b82-4ffd-9665-0d214379ac21`
Application | `Briefcase release` | `dee3e12f-4908-4f2d-b793-85847c2a4a3c`
Application | `Briefcase notes` | `935c7cda-6fad-4a4a-aa89-d5f5b8162e22`
File type | `Briefcase` | `9327645a-d4de-4366-88e2-d102fa92799a`
Service role | `Briefcase exporter` | `cae0ccc0-a85a-4ab6-8c98-0cd4ee590ef7`
Client role | `Briefcase releaser` | `146755a2-f3bc-483e-8bdf-3cb3fb4d8bec`

Each application has a schema in ConfigDB, so a malformed entry is
refused.

**`Release policy`**, on the dataset, written by releasers. Because it
is `Dataset metadata`, Data Access returns it with the dataset's
metadata.

Field | Content
---|---
`tier` | Who may have the data: `open`, `registered`, `approved-project` or `enclave-only`
`data_owner` | `{ organisation, contact: { name, email } }`
`terms` | Exactly one of `{ licence }`, an SPDX identifier, or `{ agreement }`, a data sharing agreement reference
`permitted_use` | One paragraph, shown to everyone who gets the data
`trial` | Optional trial reference
`embargo_until`, `review_by` | Optional dates

**`Briefcase release`**, on the dataset, written only by the exporter:
`{ "briefcases": [...] }`, every briefcase built from the dataset,
oldest first. Each has its `uuid`, the `file` (its Files object), its
`sha256` and `size`, when it was `built`, the `exporter` version, the
briefcase it `replaces` if any, and when it was `withdrawn` if it has
been. The live briefcase is the last one, if it has no `withdrawn`.

**`Briefcase notes`**, on the dataset, written by releasers: why each
briefcase was withdrawn, keyed by briefcase UUID, as
`{ "<uuid>": { "reason", "by" } }`. It stays inside Factory+. It is a
separate application so that releasers can say why without being able
to change the release record.

## Permissions

The exporter runs as `sv1briefcase`, in the `Briefcase exporter` role.
That role can:

* read the members of `Published`, and read Published datasets through
  Data Access (`Read dataset`);
* read `Briefcase release`, and the `General information` and `Device
  information` of each device;
* write `Briefcase release`;
* create `File` objects, add them to the `Briefcase` file type, and
  upload to the Files service.

The Files service checks `Upload` against the wildcard target, so the
grant uses it.

Administrators give people the `Briefcase releaser` role by hand. It
can read datasets through Data Access, read and change membership of
`Published`, read and write `Release policy` and `Briefcase notes`,
read `Briefcase release`, and download `Briefcase` files.

Auth applies a role's grants to its members only if the role is a
subclass of `Principal`, so the releaser role is one.

## Deployment

Value | Default | Content
---|---|---
`briefcase.enabled` | `false` | Run the exporter
`briefcase.image.repository` | `acs-briefcase` | The image to run
`briefcase.verbosity` | `ALL,!service,!token` | Debug log tags (`VERBOSE`)
`briefcase.retryInterval` | `300` | Seconds before a failed build is tried again (`RETRY_INTERVAL`)

The chart also sets `DIRECTORY_URL`, `WORK_DIR` (an `emptyDir` at
`/work`, where each briefcase is built and zipped), and
`SOURCE_ORGANISATION` and `SOURCE_URL`, from `acs.organisation` and
`acs.baseUrl`, which each briefcase records as the instance it came
from.

## Testing

`npm test` in `acs-briefcase` runs the unit tests. To check a briefcase
with the tools researchers use, build a sample from fake services and
check it:

```sh
mkdir -p /tmp/briefcase
node test/validate/make-sample.js /tmp/briefcase
pip install pyarrow bagit roc-validator
python test/validate/check.py /tmp/briefcase/*.zip
```

`check.py` validates the bag with the Library of Congress BagIt
validator, runs every required RO-Crate 1.3 check, and reads each
Parquet file with pyarrow, which must match its CSV row for row. The
`Briefcase exporter` workflow runs both on pull requests into `dev` and
`main` that touch `acs-briefcase`.

## Known gaps

* **Device details are as they are now, not as they were.** Device
  descriptions, and the metrics of a `Sub-device` dataset, come from
  each device's current origin map. Build a briefcase at the end of its
  trial, before the device's configuration changes.
* **Editing a released dataset does not rebuild it.** Withdraw it and
  publish it again to issue a corrected briefcase.
* **A failed upload leaves an empty `File` object.** The exporter cannot
  delete File objects, so each failed attempt leaves one behind.
