# Polled driver

This driver class supports read-only, polled drivers. That is, drivers
which can read data from a southbound device but cannot write data back,
and where the Edge Agent handles the poll loop. This version is not
suitable for drivers where data arrives asynchronously.

For a polled driver, the Edge Agent runs the polling loop. It sends a
message to the driver to request a poll of certain addresses; the
library will then call the `poll` function as required. Drivers are not
expected to be intelligent, just to poll the device and return the
result. Report-by-exception handling happens in the Edge Agent.

## Outline

The basic structure of a driver using this class looks like this:

```javascript
import { PolledDriver } from "@amrc-factoryplus/edge-driver";

/* This is the handler interface */
class Handler {
    
    /* This is called to create a handler */
    static create (driver, conf) { }

    /* The constructor is private */
    
    /* Methods required by Driver */
    connect () { }
    parseAddr (addr) { }
    async close () { }

    /* Methods required by PolledDriver */
    async poll (spec) { }
}

const drv = new PolledDriver({
    env:        process.env,
    handler:    Handler,
    serial:     true,
});
drv.run();
```

A handler class is required; this implements the driver functionality
and must support the documented interface. Then a generic driver object
is created passing the handler class. Every time the Edge Agent sends a
new config, the library will destroy the current handler and create a
new one. The driver will then call the `connect` method on the handler
which should attempt to connect to the southbound device.

The driver object needs access to the process environment to communicate
with the Edge Agent; this assumes the standard environment variables are
being used.

The documented API is detailed below. Any other methods or properties
are not documented and must not be relied on.

## `PolledDriver` class

A `PolledDriver` class represents the whole driver process, and handles
communication with the Edge Agent. Methods documented below can be
called from the handler class. PolledDriver inherits from
[Driver](./driver.md).

### `constructor`

    const driver = new PolledDriver({
        env:        process.env,
        handler:    HandlerClass,
        serial:     true,
    });

The `env` property is documented in the `Driver` documentation.

The `handler` property gives the handler class to use. This must support
the `PolledHandler` interface documented below.

The `serial` property is optional. If it is true, this requests that the
driver not poll more than one address at a time. Poll requests will be
queued and handled in order. If it is false or omitted poll requests may
be made in parallel.

## `PolledHandler` interface

The handler class passed to a PolledDriver must implement the `Handler`
interface documented in [the Driver class](./driver.md), and also the
methods below.

### `poll`

    const buf = await handler.poll(spec);

This method is `async`; its return value is wrapped in a Promise. The
method accepts a spec as returned from `parseAddr`, reads from the
southbound device, and returns a buffer. If the read cannot be
performed, return `undefined`.

