#!/bin/bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Asks the questions for an interactive run and writes the settings file.
# start.sh runs this when it is not given a settings file.

set -euo pipefail
. "$(dirname "$0")/lib.sh"
need_root
[ -t 0 ] || die "No terminal to ask questions on. Use: start.sh -c gateway.conf"

load_config
[ -n "${FORCE_ROLE:-}" ] && ROLE="$FORCE_ROLE"
[ -n "${FORCE_MODE:-}" ] && K3S_MODE="$FORCE_MODE"

ask () {
    # ask <variable> <question>
    local var="$1" question="$2" answer
    read -r -p "$question [${!var}]: " answer
    [ -n "$answer" ] && printf -v "$var" '%s' "$answer"
    return 0
}

list_ports () {
    local name
    echo
    echo "Wired ports on this gateway:"
    for name in $(wired_ports); do
        printf '  %-12s %s  %-5s %s\n' "$name" "$(port_mac "$name")" \
            "$(cat "/sys/class/net/$name/operstate")" "$(port_ipv4 "$name")"
    done
    echo
}

if [ "$ROLE" = gateway ]; then
    list_ports
    echo "The northbound port connects to the site network. It must have a"
    echo "fixed address, because K3s records that address when the cluster is made."
    ask NORTH_IF "Northbound port (auto, a name or a MAC address)"
    ask SOUTH_IF "Southbound port (auto, a name, a MAC address or none)"
    if [ "$SOUTH_IF" != none ]; then
        ask SOUTH_ADDR "Southbound address (for example 192.168.1.200/24, or dhcp)"
    fi
    ask ADMIN_PASSWORD "Admin password (keep or random)"
fi

if [ "$K3S_MODE" = join ]; then
    ask K3S_URL "Address of the cluster to join (for example https://fpcgw-abc123:6443)"
    ask K3S_TOKEN "Join token (on the server: sudo cat /var/lib/rancher/k3s/server/node-token)"
fi

install -d -m 700 "$GW_ETC"
umask 077
{
    echo "# Written by start.sh on $(date -Is)"
    for var in ROLE K3S_MODE K3S_DEFER K3S_URL K3S_TOKEN MULTI_NODE NORTH_IF NORTH_PROBE_URL SOUTH_IF \
               SOUTH_ADDR HOSTNAME_PREFIX GW_HOSTNAME REGISTRY_MIRROR APT_MIRROR \
               APT_MIRROR_KEY_SHA256 APT_MIRROR_ORIGIN ADMIN_PASSWORD; do
        printf '%s=%q\n' "$var" "${!var}"
    done
} > "$GW_CONF"
log "Wrote the settings to $GW_CONF"
