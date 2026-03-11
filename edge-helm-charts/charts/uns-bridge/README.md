# UNS Bridge Helm Chart

## Overview

The UNS Bridge chart deploys a Mosquitto-based MQTT bridge that forwards
UNS (Unified Namespace) topics from a local Factory+ ACS MQTT broker to
a remote MQTT broker. This enables data sharing between Factory+
clusters or with external systems.

## Architecture

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
- Custom CA certificate support for corporate TLS inspection or private CAs
- Remote credentials are accepted via the admin UI and encrypted using
  sealed secrets (as per the normal edge-deployment flow)

⚠️ **Known Limitations:**
- Remote brokers must support basic authentication (username/password).
  No authentication is not supported.

## Custom CA Certificates

If the remote broker uses a certificate signed by a private CA (e.g.
corporate networks that perform TLS inspection), you can provide a custom
CA certificate via a Kubernetes ConfigMap.

1. Create a ConfigMap containing the CA certificate with the key `ca.crt`:

   ```bash
   kubectl create configmap corporate-ca \
     --from-file=ca.crt=/path/to/corporate-ca.pem \
     -n <edge-namespace>
   ```

2. Set `remote.caConfigMapName` in the bridge values, either via the Admin
   UI "CA Certificate ConfigMap" field or directly in the Helm values:

   ```yaml
   remote:
     caConfigMapName: corporate-ca
   ```

The certificate is copied into the container's system CA store at startup,
so both the custom CA and standard public CAs are trusted.