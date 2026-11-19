#!/bin/bash
# ACS Gateway Depot
# Drives one gateway through the depot in a QEMU virtual machine.
# Copyright 2026 University of Sheffield AMRC
#
# This does what a person does in the Admin UI: boot a blank VM from the
# depot stick, approve it, wait for the install, boot it, wait for it to
# report ready, then onboard it and wait for Factory+ to see it.
#
#   DEPOT_URL=https://gateway-depot.<base> DEPOT_USER=... DEPOT_PASSWORD=... \
#       test/e2e.sh <amd64|arm64> <cluster name>
#
# The account needs the Provision gateways permission. Build the stick
# first, against the same URL:
#   stick/build-stick.sh -u "$DEPOT_URL" -a <arch> -t -o out/vm/stick-<arch>.iso
#
# Set REPLACES to the id of an onboarded gateway to install this one as
# its replacement, or JOIN to the id of one to join its cluster. Set
# STOP_AT=ready to stop before onboarding.
#
# Onboarding needs an amd64 VM unless the ACS edge images are built for
# arm64, because the bootstrap runs one of them on the gateway.

set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
arch="${1:?give amd64 or arm64}"
cluster="${2:-}"
svc="${DEPOT_URL:?set DEPOT_URL}"
mac_s="52:54:00:aa:00:02"

call () {   # call METHOD PATH [JSON]
    curl -sS -u "$DEPOT_USER:$DEPOT_PASSWORD" -X "$1" \
        -H 'Content-Type: application/json' ${3:+-d "$3"} "$svc/v1/$2"
}
field () { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1"; }
skip="${REPLACES:-}"
# The newest gateway of this architecture, as JSON.
box () {
    call GET gateway | field "json.dumps(next((b for b in d if b['inventory']['arch']=='$arch' and b['id']!='$skip' and not b.get('replaced_by')), {}))"
}
wait_state () {     # wait_state STATE SECONDS
    local end=$((SECONDS + $2)) state=
    while [ $SECONDS -lt $end ]; do
        state="$(box | field "d.get('state','')")"
        [ "$state" = "$1" ] && return 0
        [ "$state" = failed ] && { box | field "'FAILED: ' + str((d.get('onboard') or {}).get('error') or 'the install failed')" >&2; return 1; }
        sleep 5
    done
    echo "FAILED: still '$state' after $2 s, wanted '$1'" >&2
    return 1
}

# Forget gateways an earlier run left, unless one is about to be replaced
# or joined.
if [ -z "${REPLACES:-}${JOIN:-}" ]; then
    for id in $(call GET gateway | field "' '.join(b['id'] for b in d if b['inventory']['arch']=='$arch')"); do
        call DELETE "gateway/$id" >/dev/null
    done
fi

echo "==> Booting a blank $arch VM from the depot stick"
"$root/test/vm.sh" install "$root/out/vm/stick-$arch.iso" "$arch" > "$root/out/vm/e2e-install-$arch.out" 2>&1 &
installer=$!

wait_state pending 900
id="$(box | field "d['id']")"
# The northbound port is the one that is not the southbound one.
mac_n="$(box | field "next(n['mac'] for n in d['inventory']['nics'] if n['mac'] != '$mac_s')")"
echo "==> Scout registered as $id. Approving."
call POST "gateway/$id/approve" "$(python3 - "$root/out/vm/id_test.pub" <<PY
import json, sys
print(json.dumps({"north_mac": "$mac_n", "south_mac": "$mac_s", "south_addr": "192.168.1.200/24",
                  "disk": "/dev/vda", "admin_user": "fplus", "label": "e2e $arch",
                  "ssh_keys": open(sys.argv[1]).read(),
                  **({"replaces": "${REPLACES:-}"} if "${REPLACES:-}" else {})}))
PY
)" > "$root/out/vm/approval-$arch.json"
chmod 600 "$root/out/vm/approval-$arch.json"
field "'approved' if 'password' in d else d" < "$root/out/vm/approval-$arch.json"

echo "==> Waiting for the install to finish"
wait_state installed 5400
wait "$installer"

echo "==> Booting the installed gateway"
"$root/test/vm.sh" start "$arch"
wait_state ready 1800
box | field "'ready: ' + d['report']['hostname'] + ' north=' + d['report']['north'] + ' south=' + d['report']['south']"
[ "${STOP_AT:-}" = ready ] && exit 0

echo "==> Onboarding"
if [ -n "${JOIN:-}" ]; then
    body="{\"mode\": \"join\", \"server\": \"$JOIN\"}"
elif [ -n "${REPLACES:-}" ]; then
    body='{"mode": "create"}'
else
    body="$(python3 -c 'import json,sys; print(json.dumps({"mode": "create", "cluster_name": sys.argv[1]}))' "${cluster:?give a cluster name}")"
fi
call POST "gateway/$id/onboard" "$body" | field "d.get('error') or 'started: ' + d['gateway']['onboard']['step']"

last=
for _ in $(seq 1 360); do
    sleep 10
    line="$(box | field "d['state'] + ' | ' + str((d.get('onboard') or {}).get('step')) + ' | ' + str((d.get('onboard') or {}).get('error')) + ' | ' + (d.get('log') or '').strip().split(chr(10))[-1][:100]")"
    [ "$line" != "$last" ] && echo "$(date +%H:%M:%S) $line"
    last="$line"
    case "$line" in
        failed*) exit 1 ;;
        onboarded*"Factory+ can see"*) exit 0 ;;
    esac
done
echo "FAILED: gave up waiting" >&2
exit 1
