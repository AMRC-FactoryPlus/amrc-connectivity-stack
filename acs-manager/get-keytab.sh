#
# Copyright (c) University of Sheffield AMRC 2025.
#

# bin/bash
kubectl --kubeconfig ~/.kube/fpd-ago.yaml get secret manager-keytab -o jsonpath="{.data.client-keytab}" | base64 -d >"./keytab"
