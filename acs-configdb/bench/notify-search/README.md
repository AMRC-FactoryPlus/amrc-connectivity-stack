# ConfigDB notify SEARCH bench

This directory reproduces the ConfigDB CPU spiral seen on a dev cluster
during a device import, and checks the notify/v2 streams against the
real ConfigDB. It is not part of the image.

- `server.js` runs the real ConfigDB code (`Model`, routes, `WebAPI`,
  `CDBNotify`, and the service-api `Notify`) against a local
  PostgreSQL. Kerberos, the Auth service and MQTT are stubbed. It
  exposes counters on `/bench/stats`: CPU time, SEARCH `full()` calls,
  notify messages and bytes, event-loop delay, and peak memory.
- `drive.js` opens one admin UI session (the SEARCH and class WATCH
  subscriptions a real admin session opens, from the dev cluster log)
  and i3X-like WATCHes on `Info` and `DeviceInformation` for 2,400
  devices. Then it onboards devices: `POST /v2/object`, `PUT Info`,
  `PUT DeviceInformation` (a real ~4 KB body from the dump). It can
  close and reopen the admin session every K devices, as a page reload
  does.
- `verify.js` checks the exact message streams for SEARCH (with and
  without a filter), single-config WATCH, config list WATCH and class
  member WATCH, including a move to 403 and back, and a burst of writes
  while a SEARCH snapshot loads.
- `run.sh` runs one iteration from a fresh copy of the database.
- `matrix.sh` runs the standard scenarios several times and
  `summarise.js` prints median and range.

## Set up

You need Docker, Node 18 or later, and a ConfigDB dump.

```sh
cd acs-configdb
npm install --omit=optional
npm install --no-save immutable express   # imported but not declared
(cd bench/notify-search && npm install)

docker run -d --name nfspiral-pg -e POSTGRES_HOST_AUTH_METHOD=trust \
    -p 55470:5432 postgres:16
docker exec nfspiral-pg psql -U postgres -c "create database configdb_tpl"
docker exec -i nfspiral-pg psql -U postgres -d configdb_tpl < configdb.sql
```

The dump must be at the current schema version (`version` table = 14,
as `DB_Version` in `lib/model.js`). Take one from a cluster with
`kubectl exec -i postgres-1-0 -- su postgres -c "pg_dump -d configdb"`.
Errors about missing roles during the restore are harmless.

If `pg-native` fails to build, the bench uses the pure-JS `pg` driver.
The notify path does not depend on the driver.

## Run

```sh
# One run, with a CPU profile of the server:
CPU_PROF=1 bench/notify-search/run.sh try --devices 300 --conc 4 --reopen-every 50

# The standard scenarios, 3 runs each, summarised:
RUNS=3 bench/notify-search/matrix.sh <variant-name>

# Stream correctness (exits non-zero on any difference):
DRIVER=verify.js bench/notify-search/run.sh verify
```

Results, logs and `.cpuprofile` files go to `bench/notify-search/out/`.

Scenarios in `matrix.sh`:

| Scenario | Load |
|---|---|
| `burst-reload` | 300 devices, 4 writers back to back, admin page reload every 50 devices |
| `steady-reload` | 300 devices at 5 per second, admin page reload every 25 devices |
| `burst` | 300 devices, 4 writers, no reloads |
| `steady` | 300 devices at 5 per second, no reloads |
