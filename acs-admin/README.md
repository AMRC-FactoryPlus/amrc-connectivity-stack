# ACS Admin

> The [AMRC Connectivity Stack (ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk).

The ACS Admin interface provides a web-based management console for the AMRC Connectivity Stack. It allows users to:

- Monitor and manage Factory+ devices
- Configure edge agent connections
- Manage schemas and configurations
- View system status and metrics

## Developer Documentation

- [useStore](docs/useStore.md) - Reactive store utility for Factory+ objects with automatic binding resolution

## Project Setup

```sh
bun install
```

### Compile and Hot-Reload for Development

```sh
bun dev
```

### Compile and Minify for Production

```sh
bun build
```
