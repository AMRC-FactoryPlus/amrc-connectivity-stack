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

## RAG refresh benchmark

`rag-refresh.mjs` measures what one ConfigDB change costs the refresh
pipeline and what the next RAG query costs. It runs the real
`ObjectTreeRefresh`, `ObjectTree` and `I3xRag` from a compiled `dist/`.
ConfigDB is replaced by one subject per config, filled from the
synthetic fleet. It needs no InfluxDB. 8,800 devices is about 300,000
nodes; 24,000 devices is about 818,000.

```sh
node --expose-gc --max-old-space-size=8192 bench/rag-refresh.mjs \
  --dist ./dist --devices 8800 --storm 20 --gap 50
```

`--check` prints a hash of every RAG query's answers after a fixed
sequence of renames, UNS-discovered nodes, a device removal and a
device addition. Run it against two builds; equal hashes mean equal
answers:

```sh
node bench/rag-refresh.mjs --dist /tmp/i3x-before/acs-i3x/dist --devices 2000 --check
node bench/rag-refresh.mjs --dist ./dist --devices 2000 --check
```
