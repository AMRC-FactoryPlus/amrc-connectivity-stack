# ACS Architecture Overview

The AMRC Connectivity Stack (ACS) is a comprehensive implementation of the [Factory+](https://factoryplus.app.amrc.co.uk) framework, designed to provide a complete end-to-end solution for industrial connectivity and data management.

## Core Components

ACS consists of several core components that work together to provide a complete solution:

1. **MQTT Broker** - The central message broker that handles all communication between devices and services
2. **Directory Service** - Maintains a registry of all devices and services in the system
3. **Authentication Service** - Handles authentication and authorization for all components
4. **Config DB** - Stores configuration information for all components
5. **Historians** - Record data for later analysis and visualization
6. **Manager UI** - Provides a web interface for managing the system
7. **Edge Agents** - Collect data from devices and publish it to the MQTT broker

## Architecture Diagram

The ACS architecture is designed to be scalable and flexible, with a central cluster handling core services and edge clusters handling data collection:

```
┌─────────────────────────────────────────────────────────────┐
│                      Central Cluster                        │
│                                                             │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌────────────┐  │
│  │  MQTT   │  │ Directory│  │   Auth    │  │  ConfigDB  │  │
│  │ Broker  │  │ Service  │  │  Service  │  │            │  │
│  └─────────┘  └──────────┘  └───────────┘  └────────────┘  │
│                                                             │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌────────────┐  │
│  │Historian│  │ Manager  │  │Git Server │  │Visualiser  │  │
│  │         │  │   UI     │  │           │  │            │  │
│  └─────────┘  └──────────┘  └───────────┘  └────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                           ▲
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                       Edge Cluster                          │
│                                                             │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  ┌────────────┐  │
│  │  Edge   │  │  Edge    │  │ Kerberos  │  │Edge Monitor│  │
│  │ Agent   │  │  Sync    │  │   Keys    │  │            │  │
│  └─────────┘  └──────────┘  └───────────┘  └────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Communication Flow

1. Edge Agents collect data from devices and publish it to the MQTT broker
2. The MQTT broker distributes messages to subscribed services
3. The Historian records data for later analysis
4. The Manager UI provides a web interface for configuring and monitoring the system
5. The Directory Service maintains a registry of all devices and services
6. The Authentication Service ensures that only authorized users and services can access the system

## Edge Management

ACS V3 introduces a new edge management architecture that allows for the deployment and management of edge clusters. This architecture is described in detail in the [Edge Management](edge-management/overview.md) documentation.

## Next Steps

- [Core Components](core-components.md) - Learn more about the core components of ACS
- [Edge Management](edge-management/overview.md) - Learn about the edge management architecture
- [Installation](../getting-started/installation.md) - Install ACS on your Kubernetes cluster
