# ACS Core Components

The AMRC Connectivity Stack (ACS) consists of several core components that implement the Factory+ framework. Each component has a specific role in the overall architecture.

## MQTT Broker

The MQTT broker is the central message bus for all communication in the Factory+ framework. It is implemented using HiveMQ with a custom authentication plugin that integrates with the Factory+ authentication system.

Key features:
- Supports the Sparkplug B protocol
- Integrated with Factory+ authentication
- Handles all communication between devices and services

## Directory Service

The Directory Service maintains a registry of all devices and services in the system. It allows clients to discover what devices are currently online and what data they are publishing.

Key features:
- Tracks device presence and history
- Provides a REST API for querying device information
- Publishes a Sparkplug birth certificate for command escalation

## Authentication Service

The Authentication Service handles authentication and authorization for all components in the system. It uses Kerberos for authentication and provides a flexible permission model.

Key features:
- Kerberos-based authentication
- Fine-grained permission control
- Integration with MQTT for access control

## Config DB

The Config DB stores configuration information for all components in the system. It provides a central repository for configuration data that can be accessed by all services.

Key features:
- Stores device configurations
- Stores service configurations
- Provides a REST API for accessing configuration data

## Historians

ACS includes historians that record data for later analysis and visualization. There are two main historians:

1. **Sparkplug Historian** - Records Sparkplug B data
2. **UNS Historian** - Records data from the Unified Namespace

Key features:
- Uses InfluxDB for time-series data storage
- Provides a REST API for querying historical data
- Integrates with Grafana for visualization

## Manager UI

The Manager UI provides a web interface for managing the system. It allows users to configure devices, monitor system status, and manage edge clusters.

Key features:
- Device configuration
- Edge cluster management
- System monitoring
- User management

## Edge Agents

Edge Agents collect data from devices and publish it to the MQTT broker. They can be deployed on edge clusters and configured through the Manager UI.

Key features:
- Support for multiple protocols (OPC UA, Modbus, etc.)
- Configurable through the Manager UI
- Deployed on edge clusters

## Git Server

The Git Server provides Git repositories for storing configuration data. It is used by Flux to manage edge clusters.

Key features:
- Integrated with Factory+ authentication
- Supports mirroring external repositories
- Used by Flux for GitOps

## Visualiser

The Visualiser provides a visual representation of Factory+ traffic and MQTT packets. It is useful for debugging and demonstrating the capabilities of Factory+.

Key features:
- Real-time visualization of MQTT traffic
- Integration with the Manager UI
- Useful for debugging and demonstrations

## Next Steps

- [Architecture Overview](overview.md) - Return to the architecture overview
- [Edge Management](edge-management/overview.md) - Learn about the edge management architecture
- [Installation](../getting-started/installation.md) - Install ACS on your Kubernetes cluster
