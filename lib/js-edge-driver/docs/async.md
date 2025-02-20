# Async driver

This driver class supports read-only, asynchronous drivers. This is for
devices where data arrives without polling, and where requesting data is
not possible. It may be necessary for the driver to subscribe to the
device to start the data flowing.

Drivers are not expected to be intelligent, just to subscribe to the
device and return the data as it arrives. Report-by-exception handling
happens in the Edge Agent.

## Outline

The basic structure of a driver using this class looks like this:

```javascript
import { AsyncDriver } from "@amrc-factoryplus/edge-driver";

/* This is the handler interface */
class Handler {
    
    /* This is called to create a handler */
    static create (driver, conf) { }

    /* The constructor is private */
    
    /* Methods required by Driver */
    connect () { }
    parseAddr (addr) { }
    subscribe (specs) { }
    async close () { }
}

const drv = new AsyncDriver({
    env:        process.env,
    handler:    Handler,
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

## `AsyncDriver` class

An `AsyncDriver` class represents the whole driver process, and handles
communication with the Edge Agent. Methods documented below can be
called from the handler class. AsyncDriver inherits from
[Driver](./driver.md).

### `constructor`

    const driver = new AsyncDriver({
        env:        process.env,
        handler:    HandlerClass,
    });

The `env` property is documented in the Driver documentation.

The `handler` property gives the handler class to use. This must support
the `Handler` interface documented for [Driver](./driver.md). The
AsyncDriver does not expect any additional methods.

### `data`

    driver.data(spec, buffer);

This is called by the handler to push data to the driver. The `spec` is
an address spec as returned from `parseAddr`. If a spec (or an address,
for handlers with no `parseAddr` method) is supplied which the driver is
not expecting the call will simply be ignored. The `buffer` is a Buffer
containing the data to report.

This method returns a Promise which resolves when the data has been
successfully written to the Edge Agent, however normally it will not be
important to await this.
