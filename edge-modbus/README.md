# ACS Edge Modbus Driver

> The [AMRC Connectivity Stack (ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk).

This `edge-modbus` service is a driver for the ACS Edge Agent that enables communication with Modbus TCP devices. It translates Modbus register data into Factory+ compatible Sparkplug messages, formatted according to the pre-configured schema for the device.

## Overview

The Modbus driver is built using the `@amrc-factoryplus/edge-driver` library and implements a polled driver interface. It supports reading from various Modbus register types:

- Holding registers
- Input registers
- Coils
- Discrete inputs

## Configuration

The driver configuration is managed through the ACS Manager and passed to the Edge Agent, which then configures the driver. The configuration includes:

### Connection Details

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `host` | string | Yes | - | Hostname or IP address of the Modbus TCP device |
| `port` | number | No | 502 | TCP port for the Modbus connection |
| `protocol` | string | Yes | - | Must be set to "tcp" |

### Address Format

Addresses for Modbus registers use the following format:

```
id,type,address,length
```

Where:
- `id`: Device ID (unit identifier)
- `type`: Register type (holding, input, coil, discrete)
- `address`: Register address (0-based)
- `length`: Number of registers to read

Example address: `1,holding,0,1`

## Data Types

The driver returns raw buffer data from the Modbus device. The Edge Agent is responsible for converting this data to the appropriate data type based on the configuration.

## Development

### Prerequisites

- Node.js 22 or later
- npm

### Installation

```bash
npm install
```

### Running Locally

```bash
node bin/driver.js
```

The driver expects the following environment variables:
- `EDGE_MQTT`: MQTT broker URL (e.g., `mqtt://localhost:1883`)
- `EDGE_USERNAME`: MQTT username
- `EDGE_PASSWORD`: MQTT password
- `VERBOSE`: Set to enable verbose logging

## Building

The driver can be built as a Docker container:

```bash
docker build -t edge-modbus .
```

## License

MIT

## Contributing

Contributions are welcome. Please feel free to submit a Pull Request.
