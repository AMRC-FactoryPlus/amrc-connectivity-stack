# ACS Edge Agent driver library

This library exists to make it easier to write drivers for the ACS Edge
Agent. The Edge Agent exposes an MQTT broker for drivers to communicate
with and requires drivers to use a specific protocol for communication.

This version of the library supports creating read-only, polled device
drivers. Other forms of driver may be implemented in the future.

## Core concepts

Dataflow is described along a south-north axis, where the Edge Agent and
the rest of Factory+ is 'north' of the driver, and the device the driver
is reading from is 'south'. Data normally flows from south to north.

The ACS Edge Agent communicates with a driver in terms of 'addresses'.
An address is a string, in a format defined by the driver, which
identifies a particular data source within the driver's southbound
device. The main function of a driver is to read an address when
requested, returning a Buffer of binary data. The address strings are
entered into the Edge Agent configuration by an administrator and passed
down unmodified to the driver.

Depending on the Edge Agent configuration, it may expect the returned
Buffer to have some internal structure, and may attempt to read multiple
metrics from a single address. This is the function of the 'path'
parameter.

A driver will normally require configuration for such things as
hostnames, ports, authentication and so on. This configuration is
included in the Edge Agent config file and passed down to the driver as
part of the initial protocol negotiation. If a changed config is
transmitted, the library will handle this by destroying the current
handler and creating a new one using the new configuration.

## Driver implementations

Different devices have different characteristics, and require different
capabilities of the driver. A given driver should use exactly one of
these classes.

### Driver base class

[Driver](./docs/driver.md)

This is the base class for all the driver classes. Common methods and
parameters are documented here.

### Polled driver

[PolledDriver](./docs/polled.md)

This is for drivers which can read single values from the device when
requested. This driver class is not suitable for devices which may
produce data asynchronously.

### Async driver

[AsyncDriver](./docs/async.md)

This is for drivers which produce data values asynchronously and cannot
be polled.

## Utility functions

### Logging

[Debug](./docs/debug.md)

This class provides simple configurable logging.

### Buffer conversions

[BufferX](./docs/bufferx.md)

This object provides static functions to construct Buffers.
