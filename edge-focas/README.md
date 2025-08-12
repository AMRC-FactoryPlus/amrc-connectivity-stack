# Fanuc FOCAS Edge Driver

This is an Edge Agent driver for Fanuc CNC controllers using the FOCAS
(FANUC Open CNC API Specification) protocol.

## Overview

The FOCAS driver enables communication with Fanuc CNC controllers to
read real-time data such as:
- Axis positions and velocities
- Spindle speeds and loads
- Program information
- Alarm status
- Tool data
- Macro variables
- PMC data
- Modal information

## Configuration

The driver requires the following configuration parameters:

```json
{
  "host": "192.168.1.100",
  "port": 8193,
  "timeout": 5000
}
```

### Configuration Parameters

- `host` (required): IP address of the Fanuc CNC controller
- `port` (optional): FOCAS port number (default: 8193)
- `timeout` (optional): Connection timeout in milliseconds (default: 5000)
- `libraryPath` (optional): Path to FOCAS library (default: `/usr/local/lib/libfwlib32.so`)

## Address Format

The driver uses a structured address format to specify what data to read:

```
type:parameter[:subparameter]
```

### Supported Address Types

#### Axis Data
- `axis:1:position` - Position of axis 1
- `axis:1:velocity` - Velocity of axis 1
- `axis:2:position` - Position of axis 2

#### Spindle Data
- `spindle:1:speed` - Speed of spindle 1
- `spindle:1:load` - Load of spindle 1

#### Program Information
- `program:current` - Current program number
- `program:main` - Main program number

#### Alarm Status
- `alarm:status` - Current alarm status
- `alarm:count` - Number of active alarms

#### Tool Information
- `tool:current` - Current tool number

#### Macro Variables
- `macro:100` - Macro variable #100
- `macro:500` - Macro variable #500

#### PMC Data
- `pmc:R100:byte` - PMC R register 100 as byte
- `pmc:X0:bit` - PMC X input bit 0

#### Modal Information
- `modal:gcode` - Current G-code modal
- `modal:feed` - Current feed rate

## Implementation Notes

This driver uses FFI (Foreign Function Interface) to call the native
FOCAS library. The implementation includes:

✅ **FFI Bindings**: Uses `ffi-napi` to call FOCAS library functions
✅ **FOCAS Structures**: Defines ODBAXIS, ODBSPN, ODBPRO, and ODBALM structures
✅ **Connection Management**: Implements `cnc_allclibhndl3()` and `cnc_freelibhndl()`
✅ **Data Reading**: Real implementations for axis and spindle data
✅ **Error Handling**: Maps FOCAS error codes to driver status

To make it functional, you need to:

1. **Obtain FOCAS Library**: Get `libfwlib32.so` from Fanuc for Linux
2. **Choose Deployment Method**:
   - **Docker** (recommended): Include library during build with `--build-arg FOCAS_LIB=./libfwlib32.so`
   - **Local Development**: Use `./setup-focas.sh` to configure the library
3. **Configure CNC Settings**: Set your CNC's IP address and connection parameters

## FOCAS API Functions to Implement

Key FOCAS functions that should be implemented:

- `cnc_allclibhndl3()` - Allocate library handle
- `cnc_freelibhndl()` - Free library handle
- `cnc_rdaxisdata()` - Read axis data
- `cnc_rdspindlespeed()` - Read spindle speed
- `cnc_rdprgnum()` - Read program number
- `cnc_rdalmmsg()` - Read alarm messages
- `cnc_rdtool()` - Read tool data
- `cnc_rdmacro()` - Read macro variables
- `cnc_rdpmcrng()` - Read PMC data
- `cnc_modal()` - Read modal information

## Environment Variables

The driver uses standard Edge Agent environment variables:

- `EDGE_MQTT` - URL of the Edge Agent MQTT broker
- `EDGE_USERNAME` - Driver connection name
- `EDGE_PASSWORD` - MQTT password
- `VERBOSE` - Logging verbosity level

## Setup and Installation

### Docker Deployment (Recommended)

The easiest way to deploy this driver is using Docker with the FOCAS
library included during build:

```bash
# Build with FOCAS library
docker build --build-arg FOCAS_LIB=./libfwlib32.so -t edge-focas .

# Run the container
docker run -e EDGE_MQTT=mqtt://edge-agent:1883 \
           -e EDGE_USERNAME=focas_driver \
           -e EDGE_PASSWORD=your_password \
           edge-focas
```

### Local Development Setup

For local development without Docker:

#### 1. FOCAS Library Setup
```bash
# Make setup script executable
chmod +x setup-focas.sh

# Run the setup script
./setup-focas.sh
```

#### 2. Install Dependencies
```bash
npm install
```

#### 3. Configure Your CNC
Edit `edge-focas-config.json` with your CNC settings:
```json
{
  "host": "192.168.1.100",
  "port": 8193,
  "timeout": 5000,
  "libraryPath": "/usr/local/lib/libfwlib32.so"
}
```

## Docker Build Options

### Option 1: Build with FOCAS Library (Recommended)
```bash
# Include FOCAS library during build
docker build --build-arg FOCAS_LIB=./libfwlib32.so -t edge-focas .

# Run the container
docker run -e EDGE_MQTT=mqtt://edge-agent:1883 \
           -e EDGE_USERNAME=focas_driver \
           -e EDGE_PASSWORD=your_password \
           edge-focas
```

### Option 2: Build without Library (Runtime Mount)
```bash
# Build without library
docker build -t edge-focas .

# Run with library mounted at runtime
docker run -e EDGE_MQTT=mqtt://edge-agent:1883 \
           -e EDGE_USERNAME=focas_driver \
           -e EDGE_PASSWORD=your_password \
           -v /path/to/libfwlib32.so:/usr/local/lib/libfwlib32.so:ro \
           edge-focas
```

### Option 3: Development/Testing (No Library)
```bash
# Build and run without FOCAS library (will show warnings but won't crash)
docker build -t edge-focas .
docker run -e EDGE_MQTT=mqtt://edge-agent:1883 \
           -e EDGE_USERNAME=focas_driver \
           -e EDGE_PASSWORD=your_password \
           edge-focas
```

## License

Copyright 2024 AMRC - ISC License
