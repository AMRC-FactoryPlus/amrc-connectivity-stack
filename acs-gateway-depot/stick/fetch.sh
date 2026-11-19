#!/bin/bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Downloads what a gateway install needs and checks it against the
# checksums in versions.env: the Ubuntu Server image and the K3s binary.
# Run this on a machine with internet access. Files land in cache/, or
# in $DEPOT_CACHE if that is set.
#
#   stick/fetch.sh [amd64|arm64]     (default amd64, which the gateways are)
#
# Set STICK_ONLY=yes to fetch only what the depot stick needs, which is
# the Ubuntu image. Set UBUNTU_ISO_URL to download it from a mirror.

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
. "$root/gateway/versions.env"
arch="${1:-amd64}"
case "$arch" in
    amd64|arm64) ;;
    -h|--help) sed -n '5,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Architecture must be amd64 or arm64." >&2; exit 1 ;;
esac

cache="${DEPOT_CACHE:-$root/cache}"
mkdir -p "$cache"
cd "$cache"

sha256 () {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
    else shasum -a 256 "$1" | awk '{print $1}'; fi
}

# fetch <file> <url> <sha256>
fetch () {
    local file="$1" url="$2" want="$3"
    if [ -f "$file" ] && [ "$(sha256 "$file")" = "$want" ]; then
        echo "==> $file is already here and matches its checksum"
        return 0
    fi
    echo "==> Downloading $file"
    curl -fL --progress-bar -C - -o "$file" "$url"
    if [ "$(sha256 "$file")" != "$want" ]; then
        echo "ERROR: $file does not match the checksum in versions.env. Delete it and try again." >&2
        exit 1
    fi
}

if [ "${STICK_ONLY:-}" != yes ]; then
    k3s_asset=k3s
    [ "$arch" = arm64 ] && k3s_asset=k3s-arm64
    k3s_sha="K3S_SHA256_$arch"
    fetch "k3s-$arch" \
        "https://github.com/k3s-io/k3s/releases/download/${K3S_VERSION//+/%2B}/$k3s_asset" \
        "${!k3s_sha}"
fi

iso="ubuntu-$UBUNTU_VERSION-live-server-$arch.iso"
iso_sha="UBUNTU_ISO_SHA256_$arch"
if [ "$arch" = amd64 ]; then
    iso_url="https://releases.ubuntu.com/${UBUNTU_VERSION%.*}/$iso"
else
    iso_url="https://cdimage.ubuntu.com/releases/${UBUNTU_VERSION%.*}/release/$iso"
fi
fetch "$iso" "${UBUNTU_ISO_URL:-$iso_url}" "${!iso_sha}"
