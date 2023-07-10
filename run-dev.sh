#
# AMRC InfluxDB Sparkplug Ingester
# Copyright "2023" AMRC
#

# bin/bash
tmpfile=$(mktemp)
export CLIENT_KEYTAB="$(kubectl --kubeconfig ~/.kube/k3s.yaml get -n factory-plus secret krb5-keytabs -o jsonpath="{.data.sv1warehouse}" | base64 -d >"$tmpfile" && echo "$tmpfile")"
echo $CLIENT_KEYTAB
npm run start:shell
