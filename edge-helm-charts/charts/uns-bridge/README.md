# UNS Bridge Helm Chart

## Overview

The UNS Bridge chart deploys a Mosquitto-based MQTT bridge that forwards
UNS (Unified Namespace) topics from a local Factory+ ACS MQTT broker to
a remote MQTT broker. This enables data sharing between Factory+
clusters or with external systems.

## Architecture

The bridge operates with two MQTT connections:

1. **Local ACS Connection**: Subscribes to UNS topics from the local Factory+ MQTT broker using Kerberos authentication
2. **Remote Connection**: Publishes the bridged topics to a remote MQTT broker (can use username/password or other auth)

The bridge uses a local Mosquitto instance that:
- Connects to the local ACS broker and subscribes to configured topics
- Receives messages and publishes them to the local bridge instance
- Connects to the remote broker and forwards the messages

## Current Status

✅ **Working Features:**
- KerberosKey creation with proper account setup
- Authentication to local ACS MQTT broker
- Topic subscription from local broker
- Forwarding to remote MQTT broker
- Configurable topic filters
- Support for TLS on remote connection

⚠️ **Known Limitations:**
- Remote credentials must be provided as a pre-existing secret (ACS
  admin UI will be updated to create these using sealed secrets like we do
  with sensitive connection details)

## Prerequisites

### 1. Remote Broker Credentials Secret (ACS Admin UI will create these eventually)

You must create a Kubernetes secret containing the credentials for the
remote MQTT broker **before** deploying the bridge.

```bash
# For username/password authentication
kubectl create secret generic <secret-name> \
  -n factory-plus \
  --from-literal=username=<remote-username> \
  --from-literal=password=<remote-password>
```

## Installation

### Values Configuration

> This will be handled by the edge-deployment flow in ACS. This step is
> shown for reference only.

Create a values file with your bridge configuration:

```yaml
name: "my-bridge"                    # Bridge name (used in principal)
uuid: "<bridge-uuid>"                # Unique UUID for this bridge instance
cluster: "my-cluster"                # Cluster name for Kerberos principal
realm: "REALM.EXAMPLE.COM"           # Kerberos realm

authGroup:
  unsReader: "d6a4d87c-cd02-11ef-9a87-2f86ebe5ee08"  # UNS.Group.Reader UUID

directory_url: "http://directory.factory-plus.svc.cluster.local"

# Topics to bridge (MQTT topic filters)
topics:
  - UNS/v1/#

# Local ACS MQTT broker
local:
  host: mqtt.factory-plus.svc.cluster.local
  port: 1883

# Remote MQTT broker
remote:
  host: remote-broker.example.com
  port: 8883
  tls: true                          # Enable TLS for remote connection
  secretName: remote-mqtt-creds      # Name of secret with remote credentials
  usernameKey: username              # Key in secret containing username
  passwordKey: password              # Key in secret containing password
```

### Deploy with Helm

> This will be handled by the edge-deployment flow in ACS. This step is
> shown for reference only.

```bash
helm install <bridge-name> ./charts/uns-bridge \
  --values <values-file.yaml> \
  --namespace factory-plus
```

### Verify Deployment

```bash
# Check all resources
kubectl get all,kerberoskey,configmap,secret -n factory-plus -l factory-plus.app=uns-bridge

# Check pod logs
kubectl logs -n factory-plus -l factory-plus.app=uns-bridge -f

# Expected log output:
# - mosquitto version X.X.X starting
# - Connecting bridge local-acs
# - Connecting bridge remote-broker
# - mosquitto version X.X.X running
```