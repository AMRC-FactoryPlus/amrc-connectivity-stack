#!/usr/bin/env bash
# ACS Pathfindr driver
# Catalogue the live API's real response shapes.
# Copyright 2026 University of Sheffield AMRC
#
# The published documentation and the running service disagree: the
# documented asset example carries `enviro`, `fluid_level_latest` and a
# custom `attributes` array that a real response does not. This walks every
# endpoint the driver uses and records what actually comes back, so the
# driver can be built against reality rather than against the docs.
#
#   BASE=https://portal.pathfindr.co.uk \
#   CLIENT_ID=25 CLIENT_SECRET=... \
#   ./tools/catalogue-api.sh > catalogue.txt
#
# Read-only: every request is a GET apart from the token exchange. Nothing
# is created, modified or triggered. The output contains asset serials and
# site names, so treat it as you would any other site data.

set -uo pipefail

BASE="${BASE:-https://portal.pathfindr.co.uk}"

if [ -z "${TOKEN:-}" ]; then
    if [ -z "${CLIENT_ID:-}" ] || [ -z "${CLIENT_SECRET:-}" ]; then
        echo "Set TOKEN, or CLIENT_ID and CLIENT_SECRET." >&2
        exit 1
    fi
    TOKEN=$(curl -sS -X POST "$BASE/oauth/token" \
        -H "Accept: application/json" \
        -d grant_type=client_credentials \
        -d "client_id=$CLIENT_ID" \
        -d "client_secret=$CLIENT_SECRET" \
        | jq -r '.access_token // empty')
    if [ -z "$TOKEN" ]; then
        echo "Could not get a token. A 500 with an empty body usually means" >&2
        echo "the client id or secret is wrong, not that the service is down." >&2
        exit 1
    fi
    echo "# Got a token." >&2
fi

API="$BASE/api/client/v5"

# Print the status, then the keys present at each level, then the body.
# Keys matter more than values here: the question is which fields exist.
probe () {
    local label="$1" path="$2"
    echo
    echo "======================================================================"
    echo "## $label"
    echo "   GET $path"
    echo "======================================================================"

    local out code
    out=$(curl -sS -w '\n%{http_code}' -H "Authorization: Bearer $TOKEN" \
        -H "Accept: application/json" "$API$path" 2>&1)
    code=$(printf '%s' "$out" | tail -1)
    body=$(printf '%s' "$out" | sed '$d')

    echo "HTTP $code"
    if [ "$code" != "200" ]; then
        printf '%s\n' "$body" | head -5
        return
    fi

    echo "--- meta ---"
    printf '%s' "$body" | jq -c '.meta // "none"' 2>/dev/null

    echo "--- attribute keys on first record ---"
    printf '%s' "$body" | jq -c '
        (.data // .) as $d
        | (if ($d|type) == "array" then $d[0] else $d end)
        | (.attributes // .) | keys' 2>/dev/null || echo "(not an object)"

    echo "--- first record ---"
    printf '%s' "$body" | jq '
        (.data // .) as $d
        | (if ($d|type) == "array" then $d[0] else $d end)' 2>/dev/null \
        | head -80
}

echo "# Pathfindr API catalogue"
echo "# base: $BASE"

probe "Assets (collection)"            "/assets?page=1"
probe "Assets with includes"           "/assets?page=1&include=attributes"
probe "Runtime data (all)"             "/assets/runtimedata"
probe "Activity data (all)"            "/assets/activitydata"

# Everything below needs a real asset, so look one up first.
ID=$(curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
    "$API/assets?page=1" | jq -r '.data[0].id // empty')
SERIAL=$(curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
    "$API/assets?page=1" | jq -r '.data[0].attributes.serialno // empty')
ESERIAL=$(printf '%s' "$SERIAL" | jq -sRr @uri)

echo
echo "# Using asset id=$ID serial='$SERIAL'"

probe "Single asset"                   "/assets/$ID"
probe "Single asset, all includes"     "/assets/$ID?include=attributes,enviro_history,location_history,impact_history"
probe "Runtime by id"                  "/assets/$ID/runtimedata"
probe "Activity by id"                 "/assets/$ID/activitydata"
probe "Enviro history by id"           "/assets/$ID/envirohistory"
probe "Enviro history by serial"       "/assets/envirohistory?serial=$ESERIAL"
probe "Impact history by serial"       "/assets/impacthistory?serial=$ESERIAL"
probe "Runtime history by serial"      "/assets/runtimehistory?serial=$ESERIAL"
probe "Activity history by serial"     "/assets/activitydatahistory?serial=$ESERIAL"

# Topology. buildingid was 0 on the sample asset, so these may legitimately
# be empty; a 404 here is information, not a failure.
BID=$(curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" \
    "$API/assets?page=1" \
    | jq -r '[.data[].attributes.location_data.location.buildingid]
             | map(select(. != null and . != 0)) | first // empty')

if [ -n "$BID" ]; then
    echo
    echo "# Using building id=$BID"
    probe "Building"                   "/buildings/$BID"
    probe "Building cells"             "/buildings/$BID/cells"
    probe "Building assets"            "/buildings/$BID/assets"
else
    echo
    echo "# No non-zero buildingid on any asset; skipping building probes."
    echo "# That itself is worth knowing: the site topology may be unused here."
fi

echo
echo "# Done."
