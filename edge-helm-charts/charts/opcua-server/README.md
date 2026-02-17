# OPC UA Server Helm Chart

## Overview

The OPC UA Server chart deploys a lightweight OPC UA server that exposes
select UNS (Unified Namespace) topics as OPC UA tags. This enables
integration with OPC UA clients such as SCADA systems, historians, and
other industrial software.

## Architecture

The server runs a Node.js application that:
- Connects to the local ACS MQTT broker and subscribes to configured
  UNS topics
- Maintains the latest value for each topic in memory, with a
  persistent cache on a PVC so values survive pod restarts
- Serves values via an OPC UA server on port 4840 (configurable)
- Uses the UNS topic path directly as the OPC UA node hierarchy

## Current Status

✅ **Working Features:**
- KerberosKey creation with proper account setup
- Authentication to local ACS MQTT broker
- Subscription to configured UNS topics
- OPC UA server with username/password authentication
- Auto-generated OPC UA client password stored in a Secret
- Persistent last-value cache across pod restarts
- NodePort Service for external OPC UA client access
- Configurable topic filters

⚠️ **Known Limitations:**
- Tags report `null` until a UNS message is received for that topic
- OPC UA client authentication is username/password only (no
  certificates)
