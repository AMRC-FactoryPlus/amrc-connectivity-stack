#!/bin/sh
# ACS edge-agent chart
# Render the chart for each case and compare with the expected output
# Copyright 2026 University of Sheffield
#
# Each cases/<name>.yaml is a values file. If cases/<name>.out.yaml
# exists the chart must render to exactly that. If cases/<name>.error
# exists the chart must fail to render, with that text in its error.
#
# Run with UPDATE=1 to rewrite the .out.yaml files from the chart.
# Only do that when a change to the rendered output is intended, and
# check the diff.

set -u

here=$(cd "$(dirname "$0")" && pwd)
chart="$here/../../charts/edge-agent"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

failed=0
for values in "$here"/cases/*.yaml; do
    case "$values" in *.out.yaml) continue ;; esac
    name=$(basename "$values" .yaml)
    want="$here/cases/$name.out.yaml"
    error="$here/cases/$name.error"

    # Blank lines are dropped: Helm 3 and 4 place them differently.
    if helm template t "$chart" -n edge -f "$values" 2>"$tmp/err" \
        | grep -v '^[[:space:]]*$' >"$tmp/out"
        [ -s "$tmp/out" ] && [ ! -s "$tmp/err" ]
    then
        if [ -f "$error" ]; then
            echo "FAIL $name: rendered, but should have failed with: $(cat "$error")"
            failed=1
        elif [ "${UPDATE:-}" = 1 ]; then
            cp "$tmp/out" "$want"
            echo "updated $name"
        elif ! diff -u "$want" "$tmp/out"; then
            echo "FAIL $name: output differs from $name.out.yaml"
            failed=1
        else
            echo "ok $name"
        fi
    else
        if [ -f "$error" ] && grep -qF "$(cat "$error")" "$tmp/err"; then
            echo "ok $name (fails as it should)"
        else
            echo "FAIL $name: helm template failed:"
            cat "$tmp/err"
            failed=1
        fi
    fi
done

exit $failed
