#
#  Factory+ / AMRC Connectivity Stack (ACS) Manager component
#  Copyright 2023 AMRC
#

# bin/bash
kubectl --kubeconfig /Users/me1ago/.kube/ago.yaml get -n factory-plus secret manager-keytab -o jsonpath="{.data.client-keytab}" | base64 -d >"./keytab"
