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
`ur-rtde` library to establish subscriptions to robot data streams and
pushes data to the Edge Agent when values change. The ur-rtde library has been directly included in the code due to poor structuring of its actual library.

## Features

- **Real-time Data**: Subscribes to robot data streams and receives updates in real time
- **Configurable Update Rates**: Set different update rates for different data streams
- **Automatic Reconnection**: Handles connection failures with automatic retry
- **Flexible Data Access**: Access robot state, I/O, and other key data points

## Configuration

The driver configuration is managed through the ACS Manager and passed
to the Edge Agent, which then configures the driver.

### Connection Details

| Property              | Type    | Required | Default | Description                                            |
|-----------------------|---------|----------|---------|--------------------------------------------------------|
| `robotIpAddress`      | string  | Yes      | -       | IP address of the target robot controller              |
| `robotPort`           | number  | No       | 30004   | RTDE port of the robot controller                      |
| `updateFrequency`     | number  | No       | 125     | Frequency of data updates in Hz                        |
| `timeoutDelay`        | number  | No       | 5000    | Connection timeout in milliseconds                     |
| `hideConsoleWarnings` | boolean | No       | true    | Hide RTDE client console warnings                      |

### Address Format

Addresses for RTDE data streams use the following format:

### Testing
Testing has been done in standard node.js and also in a docker container but has not been deployed with a full ACS Deployment yet.

