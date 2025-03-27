helm dependency update
helm upgrade --kubeconfig=fry-acs_kubeconfig.yaml -f fry-values.yaml acs ./deploy