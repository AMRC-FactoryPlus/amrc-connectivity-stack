# ConfigDB notify benchmark and tests

This directory runs the real ConfigDB against PostgreSQL without
Kerberos or an Auth service, so you can measure and test the notify
interface on a laptop.

- `server.js` starts ConfigDB as `bin/api.js` does (same `Model`, routes,
  `WebAPI` and `CDBNotify`). Clients log in with fixed Bearer tokens
  (`admin` is root; `i3x`, `auth` and `nobody` have ACLs). ACLs go
  through the real rx-client Auth code. MQTT is off. A second port
  (`BENCH_PORT`, default 8081) serves CPU and event-loop counters and a
  CPU profiler.
- `load.js` opens a realistic watcher load and then onboards devices:
  - `i3x`: one WebSocket watching `DeviceInformation` and `Info` for
    every Device, `Schema` and `Info` for every Schema, and the members
    of Device. New Devices get their own watches, as acs-i3x does.
  - `auth`: one WebSocket watching the members of Principal, Permission
    and each of their subclasses, and searching `Registration`.
  - `admin`: one WebSocket per `--admin-tabs`, watching the members of
    every class and searching `Info` and `Registration`, as an open
    admin UI does.
  - Writes: for each device, `POST /v2/object`, `PUT Info` and `PUT
    DeviceInformation` (a ~4 KB document copied from an existing
    device), one device every `--interval` ms.
- `client.js` is a minimal notify client that records exactly what the
  server sends.

The tests in `../test` use the same server.

## Set up

You need Docker. The Node image needs the PostgreSQL client library
to build `pg-native`, which production uses.

```sh
cd acs-configdb
docker network create cdb-bench
docker run -d --name cdb-bench-pg --network cdb-bench \
    -e POSTGRES_PASSWORD=pw postgres:16

# A Node 22 image with the build tools for pg-native
printf 'FROM node:22-alpine\nRUN apk add g++ make python3 krb5-dev postgresql16-dev\n' \
    | docker build -t cdb-bench-node -

# Install dependencies inside the container
docker run --rm -v "$PWD/..:/src" -w /src/acs-configdb cdb-bench-node \
    npm install --no-save --install-links
```

Create an empty ConfigDB database for the tests:

```sh
docker run --rm --network cdb-bench -v "$PWD/sql:/sql" -w /sql \
    -e PGHOST=cdb-bench-pg -e PGUSER=postgres -e PGPASSWORD=pw \
    -e SRV_DATABASE=configdb_test -e SRV_USER=sv1configdb \
    postgres:16 psql -q -d postgres -f migrate.sql
```

## Run the tests

```sh
docker run --rm --network cdb-bench -v "$PWD/..:/src" -w /src/acs-configdb \
    -e PGHOST=cdb-bench-pg -e PGUSER=postgres -e PGPASSWORD=pw \
    -e PGDATABASE=configdb_test \
    cdb-bench-node npm test
```

`test/rx-util.test.js` needs no database. `test/notify.test.js` skips
itself if `PGHOST` is not set. It creates new objects on every run, so
you can run it repeatedly against the same database.

## Run the benchmark

The benchmark needs a populated database. The figures in the pull
request used a `pg_dump` of the fpd-ago `configdb` database (2,861
objects, 2,120 Devices, 161 classes), restored and then migrated with
`sql/migrate.sql`:

```sh
kubectl --kubeconfig ~/.kube/fpd-ago.yaml -n factory-plus \
    exec -i postgres-1-0 -- su postgres -c "pg_dump -d configdb" > configdb.sql
docker exec -i cdb-bench-pg psql -q -U postgres \
    -c "create role op1pgadmin" -c "create role sv1configdb" \
    -c "create database configdb"
docker exec -i cdb-bench-pg psql -q -U postgres -d configdb < configdb.sql
docker run --rm --network cdb-bench -v "$PWD/sql:/sql" -w /sql \
    -e PGHOST=cdb-bench-pg -e PGUSER=postgres -e PGPASSWORD=pw \
    -e SRV_DATABASE=configdb -e SRV_USER=sv1configdb \
    postgres:16 psql -q -d postgres -f migrate.sql
```

Each run writes new Devices, so restore the database between runs if
you want identical starting states (for example, keep a copy with
`create database configdb_base template configdb` and recreate
`configdb` from it).

Start the server, then the load:

```sh
docker run -d --name cdb-bench-srv --network cdb-bench \
    -v "$PWD/..:/src" -w /src/acs-configdb \
    -e PGHOST=cdb-bench-pg -e PGUSER=postgres -e PGPASSWORD=pw \
    -e PGDATABASE=configdb \
    cdb-bench-node node bench/server.js

docker run --rm --network cdb-bench -v "$PWD/..:/src" -w /src/acs-configdb \
    cdb-bench-node node bench/load.js --host cdb-bench-srv \
    --devices 100 --interval 500 --admin-tabs 1

docker rm -f cdb-bench-srv
```

Add `-e VERBOSE=1` to the server to measure with full logging. Add
`--profile /src/acs-configdb/prof.cpuprofile` to `load.js` to write a
CPU profile of the write phase (the server writes the file, so the path
is inside the server container). Open it in Chrome DevTools.

`load.js` prints one line of JSON. The main fields:

| Field | Meaning |
|---|---|
| `cpu_ms` | ConfigDB process CPU (user + system) from the first write until the server is idle again |
| `cpu_ms_per_write` | `cpu_ms` divided by the number of HTTP writes |
| `write_ms_p50`, `write_ms_p99` | HTTP latency of the writes |
| `eld_p99_ms`, `eld_max_ms` | Event-loop delay during the write phase |
| `messages`, `bytes` | Notify messages and bytes all clients received during the write phase |
| `subs` | Subscriptions held by each client |
