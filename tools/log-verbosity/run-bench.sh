#!/bin/sh
# ACS log verbosity benchmark runner.
# Runs bench.mjs in a node:22-alpine container (Linux, the same Node
# major as the ACS images) against the lib/ code from a base ref and from
# the working tree. stdout is piped to `wc`, so Node writes the log to a
# pipe synchronously, as it does in a Kubernetes pod.
#
# Usage: tools/log-verbosity/run-bench.sh [base-ref] [runs]
# Needs docker and network access (npm install of the lib dependencies).
# Set RESULTS=<file> to keep the raw per-run results (JSON lines).

set -e

base=${1:-origin/main}
runs=${2:-7}
new_verbose='ALL,!query,!acl,!notify-msg'

top=$(git rev-parse --show-toplevel)
work=$(mktemp -d "${TMPDIR:-/tmp}/acs-verbosity-bench.XXXXXX")
trap 'rm -rf "$work"' EXIT

mkdir -p "$work/base" "$work/head"
git -C "$top" archive "$base" lib | tar -x -C "$work/base"
cp -R "$top/lib" "$work/head/"
cp "$top/tools/log-verbosity/bench.mjs" "$top/tools/log-verbosity/summary.cjs" "$work/"
echo '{ "name": "acs-verbosity-bench", "private": true }' >"$work/package.json"

# Columns: lib-code scenario VERBOSE
cat >"$work/cases" <<CASES
base configdb 1
head configdb 1
head configdb $new_verbose
base configdb-import 1
head configdb-import 1
head configdb-import $new_verbose
base i3x ALL
head i3x ALL
head i3x $new_verbose
CASES

# One shared node_modules above both lib trees, holding only the
# packages that the code loaded by the benchmark imports.
docker run --rm -v "$work:/b" -w /b -e RUNS="$runs" node:22-alpine sh -c '
    set -e
    npm install --silent --no-audit --no-fund \
        pg rxjs immutable@^5.0.0-rc.2 uuid@^11 content-type isomorphic-ws \
        mqtt optional-js semver sparkplug-payload long >/dev/null
    mkdir -p node_modules/@amrc-factoryplus
    ln -s /b/head/lib/js-rx-util node_modules/@amrc-factoryplus/rx-util
    ln -s /b/head/lib/js-service-client node_modules/@amrc-factoryplus/service-client

    while read -r code scenario verbose; do
        for i in $(seq 1 $RUNS); do
            LIB="/b/$code/lib" VERBOSE="$verbose" \
                node bench.mjs "$scenario" 2>res.json | wc -lc >wc.txt
            node summary.cjs row "$code" >>results.jsonl
        done
    done <cases
    node summary.cjs table
'

if [ -n "$RESULTS" ]; then cp "$work/results.jsonl" "$RESULTS"; fi
