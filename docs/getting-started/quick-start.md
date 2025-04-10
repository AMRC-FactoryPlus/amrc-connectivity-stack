# Quick Start Guide

This guide provides a quick overview of how to get started with the AMRC Connectivity Stack (ACS). For a more detailed installation guide, see the [Installation](installation.md) documentation.

## Prerequisites

- A Kubernetes cluster
- `kubectl` installed and configured to access your cluster
- `helm` installed
- DNS configured for your domain

## Installation Steps

1. **Add the ACS Helm repository**

```bash
helm repo add amrc-connectivity-stack https://amrc-factoryplus.github.io/amrc-connectivity-stack/build
helm repo update
```

2. **Create a values.yaml file**

Create a file named `values.yaml` with the following content (replace with your own values):

```yaml
acs:
  baseUrl: factoryplus.myorganisation.com
  organisation: MYORGANISATION
  letsEncrypt:
    email: factoryplus@myorganisation.co.uk
identity:
  realm: FACTORYPLUS.MYORGANISATION.COM
```

3. **Create the namespace**

```bash
kubectl create namespace factory-plus
```

4. **Install ACS**

```bash
helm install acs amrc-connectivity-stack/amrc-connectivity-stack --version ^3.0.0 -f values.yaml --namespace factory-plus --wait --timeout 30m
```

5. **Get the admin password**

```bash
echo $(kubectl get secret krb5-passwords -o jsonpath="{.data.admin}" -n factory-plus | base64 --decode)
```

## Next Steps

1. Log into the Manager UI using the admin credentials
2. Create an Edge Cluster and follow the bootstrap instructions
3. Create a Node and Device in the Manager UI
4. Connect to the MQTT broker and start monitoring data
5. Use Grafana to create dashboards for your data

For more detailed information, see the [Installation Guide](installation.md) and [What's New in V3](whats-new-in-v3.md) documentation.
