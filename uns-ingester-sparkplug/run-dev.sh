#
# Copyright (c) University of Sheffield AMRC 2025.
#

# bin/bash
tmpfile=$(mktemp)
export CLIENT_KEYTAB="$(kubectl --kubeconfig "$KUBECONFIG" get -n factory-plus secret uns-ingester-sparkplug-keytabs -o jsonpath="{.data.client}" | base64 -d >"$tmpfile" && echo "$tmpfile")"
npm run start:shell
