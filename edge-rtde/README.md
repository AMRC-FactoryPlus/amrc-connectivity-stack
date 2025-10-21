# ACS Edge RTDE Driver

> The [AMRC Connectivity Stack
(ACS)](https://github.com/AMRC-FactoryPlus/amrc-connectivity-stack) is
an open-source implementation of the AMRC's [Factory+
Framework](https://factoryplus.app.amrc.co.uk).

This `edge-rtde` service is a driver for the ACS Edge Agent that enables
communication with RTDE (Real-Time Data Exchange) devices, primarily Universal Robots (UR) controllers.

## Overview

The RTDE driver is built using the `@amrc-factoryplus/edge-driver`
library and implements an asynchronous driver interface. It uses the
`ur-rtde` npm package to parse RTDE protocol data streams and
publishes data to the Edge Agent as it arrives from the robot.

## Features

- **Real-time Streaming**: Receives robot data at ~125Hz directly from the RTDE interface
- **Fixed Address Model**: Provides 9 predefined addresses for different data sections
- **Automatic Reconnection**: Handles connection failures with automatic retry
- **Flexible Data Access**: Access complete robot state or specific subsections (joints, cartesian, I/O, etc.)

## Configuration

The driver configuration is managed through the ACS Manager and passed
to the Edge Agent, which then configures the driver.

### Connection Details

The driver requires `host` and `port` configuration values to connect to the robot's RTDE interface.

| Property | Type   | Required | Default | Description                                    |
|----------|--------|----------|---------|------------------------------------------------|
| `host`   | string | Yes      | -       | IP address of the robot controller            |
| `port`   | number | Yes      | 30004   | RTDE port (typically 30004 for UR robots)     |

### Addresses

The RTDE driver provides fixed addresses for different sections of robot data. All addresses use the `json/` prefix to allow for future expansion to binary data formats without breaking existing deployments.

**Note:** RTDE is a streaming protocol that delivers data at approximately 125Hz from the robot. All data is published as it arrives; the driver does not poll or throttle updates.

| Address                        | Description                                                      | Data Structure |
|--------------------------------|------------------------------------------------------------------|----------------|
| `json/state`                   | Complete robot state (all data sections combined)               | Full urState object |
| `json/jointData`               | Joint positions, velocities, currents, temperatures             | Array of 6 joint objects |
| `json/cartesianInfo`           | TCP position (X, Y, Z) and orientation (Rx, Ry, Rz)            | Cartesian coordinates |
| `json/robotModeData`           | Robot mode, control mode, speeds, emergency stop status         | Mode information |
| `json/toolData`                | Tool I/O, voltage, current, temperature                         | Tool parameters |
| `json/masterboardData`         | Master board I/O, safety mode, voltage/current                  | Board status |
| `json/forceModeFrame`          | Force mode data (X, Y, Z, Rx, Ry, Rz, dexterity)              | Force information |
| `json/additionalInfo`          | Freedrive button status                                         | Additional robot info |
| `json/toolCommunicationInfo`   | Tool communication settings (baudrate, parity, etc.)            | Communication parameters |

#### Address Examples

When configuring metrics in ConfigDB, use these addresses with JSONPath expressions:

**Joint Data Examples:**
- Address: `json/jointData`, Path: `$[0].positionActual` - Joint 0 position (radians)
- Address: `json/jointData`, Path: `$[1].positionActual` - Joint 1 position (radians)
- Address: `json/jointData`, Path: `$[0].velocityActual` - Joint 0 velocity (rad/s)
- Address: `json/jointData`, Path: `$[0].currentActual` - Joint 0 current (A)

**Cartesian Position Examples:**
- Address: `json/cartesianInfo`, Path: `$.toolVectorX` - TCP X position (mm)
- Address: `json/cartesianInfo`, Path: `$.toolVectorY` - TCP Y position (mm)
- Address: `json/cartesianInfo`, Path: `$.toolVectorZ` - TCP Z position (mm)
- Address: `json/cartesianInfo`, Path: `$.toolVectorRx` - TCP rotation around X (radians)

**Robot Status Examples:**
- Address: `json/robotModeData`, Path: `$.robotMode` - Current robot mode
- Address: `json/robotModeData`, Path: `$.isEmergencyStopped` - Emergency stop status
- Address: `json/toolData`, Path: `$.toolVoltage48V` - Tool voltage (V)

### How It Works

1. The driver establishes a TCP connection to the robot's RTDE interface
2. The robot streams data packets at ~125Hz containing complete state information
3. The `ur-rtde` parser decodes each packet into a structured JavaScript object
4. The driver publishes the complete state to `json/state` and individual subsections to their respective addresses
5. The Edge Agent extracts configured metrics using JSONPath expressions and publishes to Sparkplug

### Testing

Testing has been completed with:
- Direct Node.js execution against a Universal Robots controller
- Docker containerization
- Local Edge Agent and Driver connected to F+ Instance
- Full ACS deployment integration is pending

## Dependencies

- `@amrc-factoryplus/edge-driver` - Factory+ Edge Driver framework
- `ur-rtde` - Universal Robots RTDE protocol parser
- `dotenv` - Environment variable management (Only for testing)

