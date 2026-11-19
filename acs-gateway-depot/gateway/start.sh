#!/bin/bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Configures Ubuntu as a Factory+ cell gateway: updates, hostname,
# network, firewall and K3s. Run it as a normal user with sudo rights.
#
#   ./start.sh                  ask the questions, then configure
#   ./start.sh -c gateway.conf  configure from a settings file, no questions
#   ./start.sh -s               this is an IT-hosted VM (ROLE=server)
#   ./start.sh -a               join an existing cluster (K3S_MODE=join)

set -euo pipefail
root="$(cd "$(dirname "$0")" && pwd)"

usage () {
    sed -n '5,/^$/p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

conf=
role=
mode=
while getopts "c:sah" flag; do
    case "$flag" in
        c) conf="$OPTARG" ;;
        s) role=server ;;
        a) mode=join ;;
        h) usage ;;
        *) usage 1 ;;
    esac
done

if ! grep -qsE 'DISTRIB_CODENAME=(jammy|noble)' /etc/lsb-release; then
    echo "This gateway does not run a supported Ubuntu. Use 22.04 (Jammy) or 24.04 (Noble)." >&2
    exit 1
fi

if [ "$(id -u)" != 0 ]; then
    exec sudo /bin/bash "$root/start.sh" "$@"
fi

if [ -n "$conf" ]; then
    [ -f "$conf" ] || { echo "No settings file at $conf." >&2; exit 1; }
    install -d -m 700 /etc/fplus-gw
    if [ "$(readlink -f "$conf")" != /etc/fplus-gw/gateway.conf ]; then
        install -m 600 "$conf" /etc/fplus-gw/gateway.conf
    fi
else
    FORCE_ROLE="$role" FORCE_MODE="$mode" /bin/bash "$root/sh/ask.sh"
fi

exec /bin/bash "$root/sh/configure.sh"
