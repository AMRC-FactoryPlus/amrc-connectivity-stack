# shellcheck shell=bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Prints what was set up and what to do next. Sourced by configure.sh.
# The same text goes on the console login screen, so the address and MAC
# can be read off a monitor without logging in.

summary="$(
    echo "Factory+ cell gateway: $(hostname)"
    if [ "$ROLE" = gateway ]; then
        echo "  Northbound port: $ENN  MAC $(port_mac "$ENN")  address $(port_ipv4 "$ENN")"
        if [ -n "$ENS" ]; then
            echo "  Southbound port: $ENS  MAC $(port_mac "$ENS")  address $(port_ipv4 "$ENS")"
        fi
    fi
    echo "  K3s: $(/usr/local/bin/k3s --version 2>/dev/null | awk 'NR==1 {print $3}')"
)"

if [ "$ROLE" = gateway ]; then
    mkdir -p /etc/issue.d
    printf '%s\n\n' "$summary" > /etc/issue.d/fplus-gw.issue
fi

echo
echo "$summary"
[ -f "$GW_ETC/depot.json" ] || cat <<NEXT

What to do next:
  1. Give IT the northbound MAC address above, so they register it with a
     fixed address on the shop floor network.
  2. In the Factory+ Manager, create an edge cluster, then copy its
     bootstrap command.
  3. Run that command here (or anywhere kubectl reaches this cluster). It
     asks for a Factory+ administrator login.
NEXT
