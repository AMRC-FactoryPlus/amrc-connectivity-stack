#!/bin/bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Builds the depot stick: one bootable image that works for every
# gateway. A machine booted from it starts the Ubuntu installer, reports
# its hardware to the Gateway Depot service, and waits. It installs only
# after someone approves it on the service's page, with the settings they
# chose there.
#
#   stick/build-stick.sh -u https://gateway-depot.example.org [options]
#
#   -u URL    address of the Gateway Depot service, as gateways reach it
#   -o FILE   where to write the image (default out/depot-stick-<arch>.iso)
#   -a ARCH   amd64 (default) or arm64
#   -C FILE   CA certificate to trust for the service, if it is not a public one
#   -t        send the installer to the serial port (for VM tests)
#
# Needs xorriso. Run stick/fetch.sh first to download Ubuntu.

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
. "$root/gateway/versions.env"

usage () {
    sed -n '5,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

url= out= arch=amd64 ca= serial=no
while getopts "u:o:a:C:th" flag; do
    case "$flag" in
        u) url="${OPTARG%/}" ;;
        o) out="$OPTARG" ;;
        a) arch="$OPTARG" ;;
        C) ca="$OPTARG" ;;
        t) serial=yes ;;
        h) usage ;;
        *) usage 1 ;;
    esac
done
[[ "$url" =~ ^https?://[^/]+ ]] || { echo "Give the service address with -u, starting http:// or https://." >&2; exit 1; }
command -v xorriso >/dev/null || { echo "xorriso is not installed." >&2; exit 1; }
iso="${DEPOT_CACHE:-$root/cache}/ubuntu-$UBUNTU_VERSION-live-server-$arch.iso"
[ -f "$iso" ] || { echo "Run stick/fetch.sh $arch first." >&2; exit 1; }
[ -n "$out" ] || { mkdir -p "$root/out"; out="$root/out/depot-stick-$arch.iso"; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/fplus-gw" "$stage/nocloud"
cp "$root/gateway/agent/agent.py" "$stage/fplus-gw/agent.py"
printf '{"url": "%s"}\n' "$url" > "$stage/fplus-gw/depot.json"
[ -z "$ca" ] || cp "$ca" "$stage/fplus-gw/ca.pem"

# These settings are a placeholder. The scout runs first, as an early
# command, and replaces them with the real ones once the machine is
# approved. It never returns before that, so the placeholder is never
# used to install anything.
cat > "$stage/nocloud/user-data" <<'USERDATA'
#cloud-config
autoinstall:
  version: 1
  early-commands:
    - python3 /cdrom/fplus-gw/agent.py scout
  identity:
    hostname: fpcgw-new
    username: placeholder
    password: "!"
USERDATA
: > "$stage/nocloud/meta-data"

args='autoinstall ds=nocloud\;s=/cdrom/nocloud/'
if [ "$serial" = yes ]; then
    [ "$arch" = arm64 ] && args="$args console=ttyAMA0" || args="$args console=ttyS0,115200"
fi
cat > "$stage/grub.cfg" <<GRUB
set timeout=5
menuentry "Factory+ Gateway Depot (waits for approval before installing)" {
    set gfxpayload=keep
    linux /casper/vmlinuz $args ---
    initrd /casper/initrd
}
GRUB

rm -f "$out"
xorriso -indev "$iso" -outdev "$out" -boot_image any replay \
    -map "$stage/grub.cfg" /boot/grub/grub.cfg \
    -map "$stage/nocloud" /nocloud \
    -map "$stage/fplus-gw" /fplus-gw \
    2> "$stage/xorriso.log" || { cat "$stage/xorriso.log" >&2; exit 1; }

cat <<DONE

Depot stick: $out
Service:     $url

Write the image to a USB stick. Boot any blank gateway from it with a network
cable plugged in, then approve the gateway on the service's page.
DONE
