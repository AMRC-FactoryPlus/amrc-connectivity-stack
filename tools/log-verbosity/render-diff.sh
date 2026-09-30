#!/bin/sh
# Render the ACS chart from a base ref and from the working tree and
# diff the output, to show exactly which manifests a chart change alters.
#
# Usage: tools/log-verbosity/render-diff.sh [base-ref] [extra helm args...]
# Example (defaults, then the old behaviour restored through values):
#   tools/log-verbosity/render-diff.sh origin/main
#   tools/log-verbosity/render-diff.sh origin/main \
#       --set configdb.verbosity=1 --set directory.verbosity=1 \
#       --set i3x.verbosity=ALL
#
# Needs helm and the chart dependencies in deploy/charts (run
# `helm dependency build deploy` once). Exits 1 when the renders differ.

set -e

base=${1:-origin/main}
[ $# -gt 0 ] && shift

top=$(git rev-parse --show-toplevel)
work=$(mktemp -d "${TMPDIR:-/tmp}/acs-render-diff.XXXXXX")
trap 'rm -rf "$work"' EXIT

git -C "$top" archive "$base" deploy | tar -x -C "$work"
cp -R "$top/deploy/charts" "$work/deploy/"

cat >"$work/values.yaml" <<'EOF'
acs:
  baseUrl: example.com
  organisation: EXAMPLE
identity:
  realm: EXAMPLE.COM
EOF

# The chart generates random passwords (32 random characters, base64
# encoded) and a random service-setup Job name on every render. Mask
# them so that two renders of the same chart compare equal.
render () {
    chart=$1; shift
    helm template acs "$chart" -n factory-plus -f "$work/values.yaml" "$@" \
        | sed -E \
            -e 's/: +"[A-Za-z0-9+\/]{43}="$/: "<random>"/' \
            -e 's/service-setup-[a-z0-9]{8}$/service-setup-<random>/'
}

render "$work/deploy" "$@" >"$work/base.yaml"
render "$top/deploy" "$@" >"$work/head.yaml"

diff -u --label "$base" --label "working tree" "$work/base.yaml" "$work/head.yaml"
