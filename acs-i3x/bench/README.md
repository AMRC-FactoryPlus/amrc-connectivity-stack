# Bulk current-value benchmark

This benchmark measures `POST /v1/objects/value` against a real InfluxDB
2.x. It runs the real i3X routes (`routes.js` and `APIv1`) with a real
`ObjectTree`, `ValueCache` and `History`. It replaces only Factory+ auth
(a fixed principal), ConfigDB (the tree comes from a synthetic fleet
through `ObjectTree.refreshFromSnapshot`) and MQTT (UNS messages go
straight into `ValueCache.onUnsMessage` for the warm-cache runs).

The fleet in `dataset.mjs` copies a device class and the tag schema
that historian-sparkplug writes on the dev cluster. The file header
lists the edge cases it contains.

## Files

| File | Purpose |
|---|---|
| `dataset.mjs` | Deterministic fleet: config (originMaps) and InfluxDB line protocol. |
| `seed.mjs` | Writes the fleet into an InfluxDB bucket. |
| `server.mjs` | Runs one i3X build (any compiled `dist/`) on a port. |
| `run.mjs` | Starts servers, sends requests, records the numbers, prints a table. |
| `compare.mjs` | Sends identical requests to two servers and compares the bodies byte for byte. |
| `history.mjs` | Seeds one fast metric and benchmarks a long history read. See [History benchmark](#history-benchmark). |
| `subscription-load.mjs` | Registers a large subscription under UNS load and measures the live stream. See [Subscription load benchmark](#subscription-load-benchmark). |

## Run it

Start InfluxDB 2.3.0 (the version on the dev cluster):

```sh
docker run -d --name i3xbulk-influx -p 58086:8086 \
  -e DOCKER_INFLUXDB_INIT_MODE=setup -e DOCKER_INFLUXDB_INIT_USERNAME=bench \
  -e DOCKER_INFLUXDB_INIT_PASSWORD=benchbench123 -e DOCKER_INFLUXDB_INIT_ORG=default \
  -e DOCKER_INFLUXDB_INIT_BUCKET=default -e DOCKER_INFLUXDB_INIT_ADMIN_TOKEN=bench-token \
  influxdb:2.3.0-alpine
```

Seed 2,000 devices (about 2.6 million points and 105,800 series):

```sh
cd acs-i3x
node bench/seed.mjs --bucket default --devices 2000 --points 24
```

Build the new code, and the old code from `main` into a scratch directory:

```sh
npx tsc -p .
mkdir -p /tmp/i3x-before && git archive origin/main acs-i3x | tar -x -C /tmp/i3x-before
ln -s "$PWD/node_modules" /tmp/i3x-before/acs-i3x/node_modules
(cd /tmp/i3x-before/acs-i3x && npx tsc -p .)
```

Run the benchmark:

```sh
node bench/run.mjs --build before=/tmp/i3x-before/acs-i3x/dist --build after=./dist \
  --sizes 1,100,500,1000,2000 --runs 5 --warm 0,1 --out bench-results.json
```

On macOS, prefer running the server in a Linux container on the same
Docker network as InfluxDB. The old build opens one connection per
Flux query, and on the host those go through Docker Desktop's port
proxy and the macOS port range, which fail sooner than a pod would
(`ECONNRESET`, `EADDRNOTAVAIL`). In a container the path is plain
Linux TCP and stdout is a pipe, as in Kubernetes:

```sh
docker network create i3xbulk-net
docker network connect i3xbulk-net i3xbulk-influx
node bench/run.mjs --docker-network i3xbulk-net \
  --build before=/tmp/i3x-before/acs-i3x/dist --build after=./dist \
  --sizes 1,100,500,1000,2000 --runs 5 --warm 0,1 --out bench-results.json
```

To measure a request for a few fields of wide devices, seed a
separate bucket with `--wide` extra tags per device and request the
first `--fields` leaves of each device:

```sh
node bench/seed.mjs --bucket wide --devices 200 --points 4 --wide 1000
node bench/run.mjs --bucket wide --devices 200 --wide 1000 --fields 1 \
  --build before=/tmp/i3x-before/acs-i3x/dist --build after=./dist \
  --sizes 1,10,100,200 --runs 5 --warm 0
```

Compare responses byte for byte:

```sh
node bench/server.mjs --dist ./dist --port 58101 &
node bench/server.mjs --dist /tmp/i3x-before/acs-i3x/dist --port 58102 &
node bench/compare.mjs --a http://127.0.0.1:58102 --b http://127.0.0.1:58101
```

For a mixed cache, start both servers with the same warm fraction and
UNS timestamp, for example `--warm 0.5 --uns-time 2026-09-30T18:00:00.000Z`,
then run `compare.mjs` again.

Run the equivalence test against the same InfluxDB (it creates and
deletes its own bucket):

```sh
I3X_TEST_INFLUX_URL=http://127.0.0.1:58086 npm test -- history-influx
```

Remove the container when you finish:

```sh
docker rm -f i3xbulk-influx i3xbulk-srv
docker network rm i3xbulk-net
```

## Notes

- `run.mjs` sends requests for the first N devices with `maxDepth: 0`,
  so every leaf of each device is read.
- Without `--docker-network`, the server's stdout goes to a file. File
  writes are synchronous in Node, like pipe writes on Linux, so the old
  per-element `console.log` cost shows up as it does in a pod. On macOS,
  pipe writes are asynchronous, which would hide that cost.
- The old build opens one HTTP connection per Flux query. At a few
  thousand queries a second this can exhaust local ephemeral ports
  (`connect ETIMEDOUT`), as well as hitting the InfluxDB client's 10 s
  query timeout (`Request timed out`). InfluxDB 2.x also rejects
  queries beyond its default limits of 1,024 running and 1,024 queued
  (`queue length exceeded`); the ACS chart does not change those
  defaults. `run.mjs` waits `--cooldown` seconds (default 35, longer
  than the macOS TIME_WAIT of 30 s) after any run that issued more
  than 1,000 queries.

## History benchmark

`history.mjs` measures one long history read: a single metric at 25 Hz
for 24 hours (2,160,000 points), requested whole through
`POST /v1/objects/history`. It runs the real routes and `History` from
each build against a real InfluxDB, with a one-leaf object tree in
place of ConfigDB. For each request it records the time to the first
body byte, the total time, the bytes sent and the server's peak RSS.

Start InfluxDB as above (the script defaults to port 58087), then seed
the `history` bucket:

```sh
node bench/history.mjs --seed --influx http://127.0.0.1:58087 --hours 24 --hz 25
```

Build the old code as above, then run both builds:

```sh
node bench/history.mjs --influx http://127.0.0.1:58087 \
  --build before=/tmp/i3x-before/acs-i3x/dist --build after=./dist --runs 3
```

Add `--gzip 0` to ask for an uncompressed response. `--get` uses
`GET /v1/objects/:elementId/history` instead, which only builds from
before i3X 1.0 have: 1.0 reads history in bulk only.

## Subscription load benchmark

`subscription-load.mjs` checks that live values keep flowing on an SSE
stream while a large subscription is registered, the way the Explorer
registers one. It needs no InfluxDB: History is replaced by a fake that
streams synthetic points, so the cost of Flux and of parsing its CSV is
left out. The server runs in a child process with the real routes,
`ObjectTree`, `ValueCache` and `SubscriptionManager` on a SQLite file;
UNS messages go straight into `ValueCache.onUnsMessage`.

The tree is 700 ordinary devices plus two busy devices with 240 extra
metrics each (about 24,000 objects). The stream watches one ordinary
device from the start. At 10 s the driver registers both busy devices
at maxDepth 0 and each of their leaves at maxDepth 1, reads the leaves'
values, reads an hour of history for every leaf (16 requests at a time)
and lists every object, all with `Accept-Encoding: br, gzip, deflate`.

```sh
npm run bench:subscriptions -- --hist-points 30000
```

It prints the server's event-loop delay, the longest gap between SSE
events, how old the newest value is when each read of the stream
arrives (per second from the burst), the stream's events per second and
any process warnings. `--json out.json` writes the full timeline. See
the header of the script for the other options.
