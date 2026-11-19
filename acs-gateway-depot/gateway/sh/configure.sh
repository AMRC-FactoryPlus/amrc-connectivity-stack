#!/bin/bash
# ACS Gateway Depot
# Copyright 2026 University of Sheffield AMRC
#
# Runs every configuration step in order, from the settings file. It asks
# no questions, so the first-boot service can run it as well as start.sh.
# Each step can be run again safely.

set -euo pipefail
. "$(dirname "$0")/lib.sh"
need_root
load_config

install -d -m 700 "$GW_ETC" "$GW_STATE" "$GW_BACKUP"
exec > >(tee -a /var/log/fplus-gw.log) 2>&1
log "Factory+ gateway configuration started $(date -Is) (ROLE=$ROLE, K3S_MODE=$K3S_MODE)"

. "$GW_ROOT/sh/apt.sh"

if [ "$ROLE" = gateway ]; then
    . "$GW_ROOT/sh/password.sh"
    . "$GW_ROOT/sh/network.sh"
    . "$GW_ROOT/sh/firewall.sh"
fi

# K3S_DEFER=yes is set by the Gateway Depot. The cluster records the
# gateway's address when it is created, so it must not be created until
# the gateway is on its final network. The depot agent runs this script
# again with K3S_DEFER=no when someone clicks Onboard.
if [ "$K3S_DEFER" = yes ]; then
    log "Leaving K3s until the gateway is onboarded"
else
    . "$GW_ROOT/sh/k3s-setup.sh"
fi
. "$GW_ROOT/sh/summary.sh"

date -Is > "$GW_STATE/configured"
log "Factory+ gateway configuration finished $(date -Is)"
