# ACS Edge ADS Driver

> The [AMRC Connectivity Stack
(ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is
an open-source implementation of the AMRC's [Factory+
Framework](https://factoryplus.app.amrc.co.uk).

This `edge-ads` service is a driver for the ACS Edge Agent that enables
communication with ADS (Automation Device Specification) devices,
primarily Beckhoff TwinCAT PLCs.

## Overview

The ADS driver is built using the `@amrc-factoryplus/edge-driver`
library and implements an asynchronous driver interface. It uses the
`ads-client` library to establish subscriptions to PLC symbols and
pushes data to the Edge Agent when values change.

## Features

- **Real-time Data**: Subscribes to PLC symbols and receives data when values change
- **Configurable Cycle Times**: Set different update rates for different symbols
- **Automatic Reconnection**: Handles connection failures with automatic retry
- **Symbol-based Addressing**: Uses TwinCAT symbol names directly

## Configuration

The driver configuration is managed through the ACS Manager and passed
to the Edge Agent, which then configures the driver.

### Connection Details

| Property              | Type    | Required | Default | Description                                            |
|-----------------------|---------|----------|---------|--------------------------------------------------------|
| `targetAmsNetId`      | string  | Yes      | -       | AMS NetId of the target PLC (e.g., "172.16.48.37.1.1") |
| `routerAddress`       | string  | Yes      | -       | IP address of the ADS router (usually the PLC)         |
| `targetAdsPort`       | number  | No       | 851     | ADS port of the target (851 for TwinCAT runtime)       |
| `routerTcpPort`       | number  | No       | 48898   | TCP port of the ADS router                             |
| `localAmsNetId`       | string  | No       | -       | Local AMS NetId (auto-assigned if not specified)       |
| `localAdsPort`        | number  | No       | -       | Local ADS port (auto-assigned if not specified)        |
| `timeoutDelay`        | number  | No       | 5000    | Connection timeout in milliseconds                     |
| `hideConsoleWarnings` | boolean | No       | true    | Hide ADS client console warnings                       |

### Address Format

Addresses for ADS symbols use the following format:

```
symbol_name[,cycle_time]
```

Where:
- `symbol_name`: The TwinCAT symbol name (e.g., "Global_IO.iAnalogue", "MAIN.bStart")
- `cycle_time`: Optional cycle time in milliseconds (default: 100ms)

**Examples:**
- `Global_IO.iAnalogue` - Subscribe with default 100ms cycle time
- `Global_IO.iAnalogue,500` - Subscribe with 500ms cycle time
- `MAIN.bStart,1000` - Subscribe with 1000ms cycle time

## Data Types

The driver automatically handles ADS data type conversion using the
`ads-client` library. All data is converted to JSON format and then to
buffers for transmission to the Edge Agent.

## Development

### Prerequisites

- Node.js 22 or later
- npm
- Access to a TwinCAT PLC with ADS enabled

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

### Example Configuration

```json
{
  "targetAmsNetId": "172.16.48.37.1.1",
  "routerAddress": "172.16.48.37",
  "targetAdsPort": 851,
  "routerTcpPort": 48898,
  "timeoutDelay": 5000
}
```

## Building

The driver can be built as a Docker container:

```bash
docker build -t edge-ads .
```

## Troubleshooting

### ADS Route Configuration

The PLC must have a static route configured for the driver. Add an entry to the PLC's route table with:
- AmsNetId: The driver's local AMS NetId (if specified)
- Address: The driver's IP address
- Transport Type: TCP/IP

## License

MIT

## Contributing

Contributions are welcome. Please feel free to submit a Pull Request.