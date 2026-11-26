# shellcheck shell=bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Shared helpers and settings. Sourced by the other scripts.

GW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GW_ETC=/etc/fplus-gw
GW_CONF="${GW_CONF:-$GW_ETC/gateway.conf}"
GW_STATE=/var/lib/fplus-gw
GW_BACKUP=/var/backups/fplus-gw

log () { printf '==> %s\n' "$*"; }
warn () { printf 'WARNING: %s\n' "$*" >&2; }
die () { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

need_root () {
    [ "$(id -u)" = 0 ] || die "This step must run as root."
}

# Set every setting to its default, then read the settings file over the top.
load_config () {
    ROLE=gateway
    K3S_MODE=create
    K3S_DEFER=no
    K3S_URL=
    K3S_TOKEN=
    MULTI_NODE=no
    NORTH_IF=auto
    NORTH_PROBE_URL=
    SOUTH_IF=auto
    SOUTH_ADDR=
    HOSTNAME_PREFIX=fpcgw
    GW_HOSTNAME=
    REGISTRY_MIRROR=
    APT_MIRROR=
    APT_MIRROR_KEY=
    APT_MIRROR_KEY_SHA256=
    APT_MIRROR_ORIGIN=
    ADMIN_PASSWORD=keep

    if [ -f "$GW_CONF" ]; then
        # shellcheck disable=SC1090
        . "$GW_CONF"
    fi

    case "$ROLE" in gateway|server) ;; *) die "ROLE must be gateway or server, not '$ROLE'." ;; esac
    case "$K3S_MODE" in create|join) ;; *) die "K3S_MODE must be create or join, not '$K3S_MODE'." ;; esac
    if [ "$K3S_MODE" = join ] && { [ -z "$K3S_URL" ] || [ -z "$K3S_TOKEN" ]; }; then
        die "K3S_MODE=join needs K3S_URL and K3S_TOKEN."
    fi
    return 0
}

# The wired network ports on this machine, one name per line.
wired_ports () {
    local dev name
    for dev in /sys/class/net/*; do
        name="${dev##*/}"
        [ -e "$dev/device" ] || continue          # skip lo, bridges, veth, wireguard
        [ -d "$dev/wireless" ] && continue
        [ "$(cat "$dev/type")" = 1 ] || continue  # Ethernet only
        echo "$name"
    done
}

# Turn an interface name or a MAC address into an interface name.
resolve_port () {
    local want="$1" name
    if [ -e "/sys/class/net/$want" ]; then
        echo "$want"
        return 0
    fi
    want="$(echo "$want" | tr '[:upper:]' '[:lower:]')"
    for name in $(wired_ports); do
        if [ "$(cat "/sys/class/net/$name/address")" = "$want" ]; then
            echo "$name"
            return 0
        fi
    done
    return 1
}

port_mac () { cat "/sys/class/net/$1/address"; }

port_ipv4 () {
    ip -o -4 addr show dev "$1" scope global 2>/dev/null | awk '{print $4}' | head -n 1
}

# The architecture name K3s and Ubuntu use for this machine.
machine_arch () {
    case "$(uname -m)" in
        x86_64) echo amd64 ;;
        aarch64|arm64) echo arm64 ;;
        *) die "Unsupported CPU architecture $(uname -m)." ;;
    esac
}
