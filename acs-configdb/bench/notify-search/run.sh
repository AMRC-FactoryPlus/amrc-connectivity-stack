#!/bin/sh
# Run one ConfigDB notify bench iteration.
#
#   bench/notify-search/run.sh <label> [drive.js args...]
#
# Needs a Postgres with the ConfigDB dump loaded as database
# configdb_tpl (see README.md here). Each run clones it to
# configdb_run so every run starts from the same data.
#
# Env: PGHOST PGPORT PGUSER (default localhost 55470 postgres),
#      PG_CONTAINER (default nfspiral-pg), OUT (default bench/notify-search/out),
#      CPU_PROF=1 to write a .cpuprofile of the server,
#      DRIVER=verify.js to run the correctness check instead of the load.
set -e
cd "$(dirname "$0")/../.."

label=$1; shift
: ${PGHOST:=localhost} ${PGPORT:=55470} ${PGUSER:=postgres}
: ${PG_CONTAINER:=nfspiral-pg} ${OUT:=bench/notify-search/out}
export PGHOST PGPORT PGUSER
mkdir -p "$OUT"

docker exec "$PG_CONTAINER" psql -U "$PGUSER" -q \
    -c "drop database if exists configdb_run" \
    -c "create database configdb_run template configdb_tpl"

prof=""
[ -n "$CPU_PROF" ] && prof="--cpu-prof --cpu-prof-dir=$OUT --cpu-prof-name=$label.cpuprofile"

PGDATABASE=configdb_run node --expose-gc $prof bench/notify-search/server.js \
    > "$OUT/$label.server.log" 2>&1 &
srv=$!
trap 'kill $srv 2>/dev/null || true' EXIT

until grep -q "BENCH READY" "$OUT/$label.server.log"; do
    kill -0 $srv 2>/dev/null || { cat "$OUT/$label.server.log"; exit 1; }
    sleep 0.2
done

rc=0
node "bench/notify-search/${DRIVER:-drive.js}" --out "$OUT/$label.json" "$@" \
    > "$OUT/$label.drive.log" || rc=$?
kill -TERM $srv
wait $srv || true
trap - EXIT
if [ "${DRIVER:-drive.js}" != drive.js ]; then
    cat "$OUT/$label.drive.log"
    exit $rc
fi
node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1]));
const s = r.server;
console.log([process.argv[2], "cpu_s=" + (s.cpu_ms/1000).toFixed(1),
  "full=" + s.full_calls, "msgs=" + s.msgs, "MB=" + (s.bytes/1e6).toFixed(1),
  "eld_max_ms=" + s.eld_max_ms.toFixed(0), "writes_s=" + r.writes_per_s.toFixed(1),
  "lag_ms=" + r.deliver_lag_ms.toFixed(0), "settle_ms=" + r.settle_ms.toFixed(0),
  "rss_MB=" + (s.peak_rss/1e6).toFixed(0), "map_ok=" + r.final_map_matches_db].join(" "));
' "$OUT/$label.json" "$label"
