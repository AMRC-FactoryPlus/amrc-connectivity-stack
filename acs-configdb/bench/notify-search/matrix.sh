#!/bin/sh
# Run the standard bench scenarios RUNS times each (default 3), then
# summarise. Labels are <variant>-<scenario>-<n>.
#
#   bench/notify-search/matrix.sh <variant> [scenario...]
#
# Scenarios (all with ~4,800 i3X-like WATCHes and one admin session):
#   burst-reload    300 devices, 4 writers, admin page reload every 50
#   steady-reload   300 devices at 5/s, admin page reload every 25
#   burst           300 devices, 4 writers, no reloads
#   steady          300 devices at 5/s, no reloads
set -e
cd "$(dirname "$0")/../.."
variant=$1; shift
scenarios=${*:-burst-reload steady-reload burst steady}
: ${RUNS:=3} ${OUT:=bench/notify-search/out}
export OUT

for sc in $scenarios; do
    case $sc in
    burst-reload)   args="--devices 300 --conc 4 --reopen-every 50" ;;
    steady-reload)  args="--devices 300 --rate 5 --reopen-every 25" ;;
    burst)          args="--devices 300 --conc 4" ;;
    steady)         args="--devices 300 --rate 5" ;;
    *) echo "Unknown scenario $sc"; exit 1 ;;
    esac
    i=1
    while [ $i -le $RUNS ]; do
        prof=""
        # Profile the first run of each scenario.
        [ $i -eq 1 ] && prof=1
        CPU_PROF=$prof bench/notify-search/run.sh "$variant-$sc-$i" $args
        i=$((i+1))
    done
done
node bench/notify-search/summarise.js "$OUT" "$variant"
