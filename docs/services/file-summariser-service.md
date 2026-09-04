# ACS File Summariser

`acs-file-summariser` is a central background service that watches [ConfigDB](/docs/configDB) for files uploaded to [ACS-Files](/docs/services/file-service.md), downsamples large data files (e.g. TDMS waveform captures), and writes the resulting summary into InfluxDB so it can be browsed in Grafana without needing to download the full file.

It has no HTTP API; it is a pure reactive worker, structured the same way as `acs-edge-sync`.

## How it works

1. It subscribes to ConfigDB's notify interface and watches the members of every registered `File_Type` class (currently just `Files.FileType.TDMS`).
2. For each file it hasn't already summarised, it reads that file's per-object configuration from the `Files.App.Summary` ConfigDB Application (UUID `d34ff2d4-61ce-4488-b74c-81b1bbb7abac`), e.g.:
   ```json
   { "n": 1000 }
   ```
   If no configuration is set, the summariser plugin's own default is used (`n: 1000` for TDMS).
3. It downloads the file from ACS-Files to a local scratch directory (streamed to disk, never buffered in memory).
4. It hands the file to the summariser plugin registered for that file's type, which parses it and yields downsampled rows without holding the whole file - or the whole summary - in memory at once.
5. Rows are batched and written to InfluxDB.
6. Once a file is fully summarised, that fact is recorded durably in ConfigDB (`Files.App.SummaryState`), and the scratch copy is deleted. If processing fails, the scratch copy is still deleted and the file is retried periodically (see [Retries](#retries)).

Because it re-derives "what needs doing" from ConfigDB on every startup, restarting the service is always safe - it just re-checks every registered file's state rather than tracking progress in memory or on local disk.

## Memory and CPU safety

This service is intentionally conservative, since it runs centrally rather than one instance per edge site, and the files it handles can be tens of gigabytes:

- Only one file is processed at a time by default (`MAX_CONCURRENT_JOBS=1`). Raise this only after confirming the resource limits below can absorb it.
- Files are streamed to a scratch volume on disk, never read into Node's memory as a whole.
- The TDMS plugin parses the file in bounded windows (1,000,000 samples at a time per channel, see `lib/summarisers/tdms_summarise.py`) rather than loading a whole channel into memory, and streams its output to Node as NDJSON line-by-line rather than building the full summary in memory before returning it.
- The container has `resources.requests`/`limits` and `NODE_OPTIONS=--max-old-space-size` set in the Helm chart - see `deploy/values.yaml`'s `fileSummariser` block.

See [Known limitations](#known-limitations) for the one case where the memory bound above doesn't hold.

## Extending to a new file type

Nothing outside `lib/summarisers/` is specific to TDMS. To add support for a new file type:

1. Register a new `File_Type` class in ConfigDB bootstrap (see how `Files.FileType.TDMS` is set up in `acs-service-setup/dumps/files.yaml`), and grant this service's service account `ConfigDB.Perm.ReadMembers` on it.
2. Add a plugin module under `lib/summarisers/`, exporting:
   - `defaultConfig` - the configuration to use when a file has none set in `Files.App.Summary`.
   - `async function* summarise(filePath, config)` - an async generator that reads `filePath` (already downloaded to local disk) and yields plain row objects: `{ measurement, tags, fields, timestamp }`. `timestamp` should be a pre-formatted nanosecond epoch string (see [Timestamp precision](#timestamp-precision) below for why).
3. Add one line to `lib/summarisers/index.js` mapping the new class UUID to the plugin.

The dispatcher, queue, state tracking and InfluxDB writer are all file-type-agnostic and need no changes.

## Configuration

Standard Factory+ service client variables are read from the environment by `@amrc-factoryplus/service-client` (`DIRECTORY_URL`, `REALM`, `CLIENT_KEYTAB`, `VERBOSE`, etc.) - see the [service client documentation](../lib/js-service-client). In addition:

| Variable             | Meaning                                                                    | Default        |
|----------------------|-----------------------------------------------------------------------------|----------------|
| `INFLUX_URL`         | URL of the InfluxDB server.                                                  | *(required)*   |
| `INFLUX_ORG`         | InfluxDB organisation to write to.                                           | *(required)*   |
| `INFLUX_BUCKET`      | InfluxDB bucket to write to.                                                 | *(required)*   |
| `INFLUX_TOKEN`       | InfluxDB auth token.                                                         | *(required)*   |
| `BATCH_SIZE`         | Points to buffer before auto-flushing to InfluxDB.                          | `5000`         |
| `FLUSH_INTERVAL`     | Milliseconds before buffered points are flushed even if `BATCH_SIZE` isn't reached. | `10000` |
| `SCRATCH_DIR`        | Local directory used to hold a file while it's being summarised.            | `/scratch`     |
| `MAX_CONCURRENT_JOBS`| Number of files to summarise at once.                                       | `1`            |
| `PYTHON_BIN`         | Path to the Python interpreter used to run summariser scripts (e.g. the TDMS plugin). | `/opt/venv/bin/python3` |

## ConfigDB objects

| UUID                                   | Name                        | Purpose                                                                 |
|-----------------------------------------|-----------------------------|--------------------------------------------------------------------------|
| `d34ff2d4-61ce-4488-b74c-81b1bbb7abac`  | `Files.App.Summary`          | Per-file, admin-editable summarisation config (e.g. `{"n": 1000}`).      |
| `439444d4-b0a5-45f8-ab0f-9bc41574ffa3`  | `Files.App.SummaryState`     | Internal, owned solely by this service - per-file `done`/`error` status. |
| `55d5807d-3ee7-4f0a-97a1-fd2b6458ff2f`  | `Files.FileType.TDMS`        | The `File_Type` class this service currently watches.                   |
| `228366d4-d95c-4d87-86ef-7edba5e065b4`  | `Files.Requirement.SummariserServiceAccount` | This service's own ConfigDB/Auth service role.           |

These are also defined in `lib/constants.js` for use by the service itself, and in `acs-service-setup/lib/uuids.js` / `acs-service-setup/dumps/files.yaml` for cluster bootstrap.

## Retries

`watch_members` only re-emits when a class's membership actually changes, so a file whose summarisation failed (corrupt data, a transient download error, InfluxDB unavailable, etc.) wouldn't otherwise be retried until some other file was added to the same class. To avoid that, the dispatcher also re-checks all members on a jittered timer (every ~5 minutes) regardless of whether membership changed, and re-queues anything not marked `done`. There's no separate backoff counter - a permanently-broken file is simply retried on this same interval indefinitely, with its last error visible in `Files.App.SummaryState`.

## Timestamp precision

Nanosecond epoch timestamps (~1.7×10^18) exceed what a JSON number / JS `Number` can represent exactly (`Number.MAX_SAFE_INTEGER` is ~9×10^15). To avoid silently corrupting timestamps:

- The TDMS Python script computes timestamps as arbitrary-precision Python integers and emits them as **strings** in its NDJSON output.
- `lib/influx.js` passes that string straight to `Point.timestamp()`, which the InfluxDB client writes verbatim into the line-protocol timestamp field rather than round-tripping it through a floating-point number.

Any new plugin should follow the same convention.

## Known limitations

- **nptdms only exposes microsecond precision for a channel's absolute start time** (`wf_start_time`), even though the TDMS format and `wf_increment` support finer resolution. Per-sample spacing is still nanosecond-accurate (computed from `wf_increment` directly), only the absolute start reference is limited to microseconds - this is a limitation of the `nptdms` library, not of this service.
- **The bounded-memory read only holds if the source TDMS file is written in multiple reasonably-sized segments**, which is how real acquisition hardware streams data to disk. A pathological TDMS file written as a single giant segment can cause `nptdms` to do more work decoding a chunk internally; this was tested (see below) and doesn't reintroduce the original full-file-in-memory problem for realistic files, but it's worth knowing about if a summarisation job for a specific file is unexpectedly slow or memory-hungry.
- There's no schema validation on `Files.App.Summary` config values (e.g. a non-numeric `n`).

