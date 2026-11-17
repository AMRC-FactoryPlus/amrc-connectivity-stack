#!/bin/sh
# ACS chart
# Check what serviceSetup.config.splitDrivers service-setup receives
# Copyright 2026 University of Sheffield
#
# A site whose Edge Agents still run version 6 holds a protocol's
# connections on the built-in drivers with `<PROTO>: hold` (see
# docs/architecture/edge-management/split-drivers.md). That only works
# if the value reaches service-setup through Helm's merge of the site's
# values over the chart's. A null does not, on every Helm version:
# Helm 4.0 drops it. This renders the chart's service-setup Job with a
# site's values and checks the SS_CONFIG it would get.
#
# The chart is rendered without its subcharts, which service-setup's
# template doesn't use, so no chart repository is needed.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

cp -R "$here/.." "$tmp/chart"
rm -rf "$tmp/chart/charts" "$tmp/chart/Chart.lock" "$tmp/chart/test"
# Drop the dependencies block, which runs from its key to the next
# top-level key or the end of the file.
awk '/^dependencies:/ { skip = 1; next } skip && /^[^ #-]/ { skip = 0 } !skip' \
    "$tmp/chart/Chart.yaml" > "$tmp/Chart.yaml"
mv "$tmp/Chart.yaml" "$tmp/chart/Chart.yaml"

render () {
    helm template acs "$tmp/chart" -n factory-plus "$@" \
        --show-only templates/service-setup.yaml \
        | grep -A1 'name: SS_CONFIG' | sed -n 's/^ *value: //p'
}

failed=0
expect () {
    case "$2" in
        *"$3"*) echo "ok $1" ;;
        *) echo "FAIL $1: SS_CONFIG has no $3"; echo "  $2"; failed=1 ;;
    esac
}

cat > "$tmp/site.yaml" <<'VALUES'
serviceSetup:
  config:
    splitDrivers:
      REST: hold
      MQTT: false
VALUES

expect "chart default" "$(render)" '\"splitDrivers\":{}'
site=$(render -f "$tmp/site.yaml")
expect "hold from a values file" "$site" '\"REST\":\"hold\"'
expect "false from a values file" "$site" '\"MQTT\":false'
expect "hold from --set" \
    "$(render --set serviceSetup.config.splitDrivers.REST=hold)" '\"REST\":\"hold\"'

# The move runs in its own init container, after edge-helm-charts, and
# must get the same config.
order=$(helm template acs "$tmp/chart" -n factory-plus -f "$tmp/site.yaml" \
    --show-only templates/service-setup.yaml \
    | sed -n 's/^        - name: \([a-z-]*\)$/\1/p' | tr '\n' ' ')
expect "split-drivers runs after edge-helm-charts" "$order" \
    'service-setup edge-helm-charts split-drivers'
step=$(helm template acs "$tmp/chart" -n factory-plus -f "$tmp/site.yaml" \
    --show-only templates/service-setup.yaml \
    | sed -n '/^        - name: split-drivers$/,/^        - name: /p')
expect "split-drivers has its step" "$step" 'value: split-drivers'
expect "split-drivers gets the site's hold" "$step" '\"REST\":\"hold\"'

exit $failed
