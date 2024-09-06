#
# AMRC InfluxDB UNS Historian
# Copyright "2023" AMRC
#

# bin/bash
tmpfile=$(mktemp)
export CLIENT_KEYTAB="$(kubectl --kubeconfig <KUBECONFIG_FILE> get -n factory-plus secret krb5-keytabs -o jsonpath="{.data.sv1historianuns}" | base64 -d >"$tmpfile" && echo "$tmpfile")"
npm run start:shell
