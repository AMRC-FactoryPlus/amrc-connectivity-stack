#!/bin/bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Builds the depot stick where the Gateway Depot service serves it from,
# so people can download it from the Admin UI. The ACS Helm chart runs
# this as a Job on every install and upgrade. It does nothing if the
# stick already there was built from the same inputs.
#
#   DEPOT_DIR=/depot PUBLIC_URL=https://gateway-depot.<base> stick/bake.sh
#
# Set GATEWAY_CA_FILE to a CA certificate if the service's certificate
# does not come from a public CA. Set UBUNTU_ISO_URL to download Ubuntu
# from a mirror.

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
. "$root/gateway/versions.env"
arch=amd64
dir="${DEPOT_DIR:?set DEPOT_DIR}"
url="${PUBLIC_URL:?set PUBLIC_URL}"
url="${url%/}"
ca="${GATEWAY_CA_FILE:-}"
[ -z "$ca" ] || [ -f "$ca" ] || { echo "No CA certificate at $ca." >&2; exit 1; }

export DEPOT_CACHE="$dir/cache"
stick="$dir/stick"
name="depot-stick-$arch.iso"
mkdir -p "$DEPOT_CACHE" "$stick"

# What the stick is built from. The service works out the same value to
# tell whether the stick it holds is current.
made_from="$( { printf '%s\n%s\n' "$url" "$UBUNTU_VERSION"
    cat "$root/gateway/agent/agent.py"
    [ -z "$ca" ] || cat "$ca"; } | sha256sum | awk '{print $1}')"

if [ -f "$stick/$name" ] && grep -qs "\"made_from\": \"$made_from\"" "$stick/$name.json"; then
    echo "==> The depot stick is already up to date"
    exit 0
fi

date +%s > "$stick/building"
trap 'rm -f "$stick/building" "$stick/$name.new"' EXIT

STICK_ONLY=yes "$root/stick/fetch.sh" "$arch"
"$root/stick/build-stick.sh" -u "$url" -a "$arch" -o "$stick/$name.new" ${ca:+-C "$ca"} >/dev/null

size="$(stat -c %s "$stick/$name.new")"
rm -f "$stick/$name.json"
mv "$stick/$name.new" "$stick/$name"
cat > "$stick/$name.json" <<JSON
{
  "arch": "$arch",
  "ubuntu": "$UBUNTU_VERSION",
  "size": $size,
  "built_at": $(date +%s)000,
  "made_from": "$made_from"
}
JSON
echo "==> Built $stick/$name ($size bytes) for $url"
