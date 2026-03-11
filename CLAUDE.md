# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The AMRC Connectivity Stack (ACS) is a Kubernetes-deployed implementation of the [Factory+](https://factoryplus.app.amrc.co.uk) framework for industrial connectivity and data management. It consists of central cluster services (MQTT broker, Directory, Auth, ConfigDB, Historians, Manager UI) and edge agents that collect data from industrial devices.

## Repository Structure

- `lib/` - Shared libraries (must build first)
  - `js-service-client` - Main client library for Factory+ services
  - `js-service-api` - Base classes for building service APIs
  - `js-edge-driver` - Base driver class for edge translators
  - `js-sparkplug-app` - Sparkplug B protocol utilities
  - `js-pg-client`, `js-rx-client`, `js-rx-util` - Database and reactive utilities
  - `py-edge-driver` - Python edge driver base
  - `java-service-client` - Java client library

- `acs-*` - Central cluster services (Auth, ConfigDB, Directory, etc.)
- `edge-*` - Edge protocol translators (Modbus, BACnet, ADS, etc.)
- `historian-*`, `uns-ingester-*` - Data ingestion services
- `deploy/` - Helm chart for Kubernetes deployment
- `mk/` - Makefile fragments

## JavaScript Services

Most services are ES modules using `@amrc-factoryplus/service-client` for Factory+ integration. Services reference local libraries via `file:../lib/js-*` in package.json.

TypeScript services (like `acs-edge`) use:
```bash
npm run dev    # Development with ts-node-dev
npm run build  # Compile TypeScript
npm run test   # Run Jest tests
```

## Key Patterns

- Services authenticate via Kerberos to the MQTT broker
- Configuration is stored in ConfigDB and accessed via the service client
- Edge agents publish Sparkplug B messages to the MQTT broker
- The `@amrc-factoryplus/service-client` library provides `ServiceClient` class for accessing Factory+ services

## Contributing

- Branch naming: `initials/branch-description` or `feature/xxx` for long-running branches
- Commit messages: imperative mood, explain the "why", reference issues
- Keep PRs focused on a single issue/feature
- Rebase onto `main` rather than merging
