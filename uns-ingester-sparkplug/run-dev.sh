#
# AMRC ACS UNS Ingester (Sparkplug)
# Copyright "2023" AMRC
#

# bin/bash
tmpfile=$(mktemp)
export CLIENT_KEYTAB="$(kubectl --kubeconfig "$KUBECONFIG" get -n factory-plus secret krb5-keytabs -o jsonpath="{.data.sv1sparkplugingester}" | base64 -d >"$tmpfile" && echo "$tmpfile")"
npm run start:shell
