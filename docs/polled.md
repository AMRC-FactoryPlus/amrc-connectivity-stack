# Polled driver

This driver class supports read-only, polled drivers. That is, drivers
which can read data from a southbound device but cannot write data back,
and where the Edge Agent handles the poll loop. This version is not
suitable for drivers where data arrives asynchronously, or where a
subscription must be made to the southbound device.

For a polled driver, the Edge Agent runs the polling loop. It sends a
message to the driver to request a poll of certain addresses; the
library will then call the `poll` function as required. Drivers are not
expected to be intelligent, just to poll the device and return the
result. Report-by-exception handling happens in the Edge Agent.

## Outline

The basic structure of a driver using this class looks like this:

```javascript
import { PolledDriver } from "@amrc-factoryplus/edge-driver";

class Handler {
    /* This is the handler interface */

    parseAddr (addr) { }
    async poll (spec) { }
    async close () { }

    /* These methods are private between the Handler class and the
     * createHandler function. */

    constructor (driver, conf) {
        this.driver = driver;
        this.conf = conf;
    }

    async run () {
        /* Connect to southbound device */
        this.driver.setStatus("UP");
    }
}

function createHandler (driver, conf) {
    /* Validate config */
    const handler = new Handler(driver, conf);
    handler.run();
    return handler;
}

const drv = new PolledDriver({
    env:        process.env,
    handler:    createHandler,
    serial:     true,
});
drv.run();
```

A handler class is required; this implements the driver functionality
and must support the documented interface. Then a generic driver object
is created, and passed a factory function to build a handler. Every time
the Edge Agent sends a new config, the library will destroy the current
handler and create a new one. The driver object needs access to the
process environment to communicate with the Edge Agent; this assumes the
standard environment variables are being used. Finally the `run` method
must be called on the driver object to start the communication; this
will not return.

The documented API is detailed below. Any other methods or properties
are not documented and must not be relied on.

## `PolledDriver` class

A `PolledDriver` class represents the whole driver process, and handles
communication with the Edge Agent.

### `constructor`

    const driver = new PolledDriver({
        env:        process.env,
        handler:    handlerFactory,
        serial:     true,
    });

The `env` property should be `process.env`, or a suitable substitute.
The keys `EDGE_MQTT`, `EDGE_USERNAME` and `EDGE_PASSWORD` will be used
to initiate communication with the Edge Agent.

The `handler` function creates a handler object when the driver has been
sent a new configuration. The function takes two arguments, the driver
object itself and the configuration. If the function returns a false
value the driver will report a `CONF` error.

The `serial` property is optional. If it is true, this requests that the
driver not poll more than one address at a time. Poll requests will be
queued and handled in order. If it is false or omitted poll requests may
be made in parallel.

### `setStatus`

    driver.setStatus("UP");

This method should be called by the handler to report the status of its
southbound connection, or other problems. The argument is a string;
valid values are:

Status | Meaning
---|---
`UP`    | We are successfully connected southbound.
`CONN`  | There is a problem connecting southbound.
`AUTH`  | There is a problem authenticating to the southbound device.
`ERR`   | Some other error has occurred.

### `run`

    driver.run();

This method starts the communication with the Edge Agent. It does not
return.

## Handler interface

The handler factory function accepts a driver object and a
configuration, and returns a handler or false. Objects returned from the
factory function must support the interface specified below. The
constructor is called by the factory function, so is not specified as
part of the interface.

The factory function needs to initiate connection to the southbound
device; it is not good practice for a constructor to have external
effects, so this will probably mean calling a method on the handler
object before returning it. This should eventually result in a call to
the driver `setStatus` method.

### `parseAddr`

    const spec = handler.parseAddr(addr);

This method parses an address string and returns a data structure
suitable to use for polling the southbound device. Returning the same
string is acceptable. The string should be validated for syntax, but no
IO can be performed.

### `poll`

    const buf = await handler.poll(spec);

This method is `async`; its return value is wrapped in a Promise. The
method accepts a spec as returned from `parseAddr`, reads from the
southbound device, and returns a buffer. If the read cannot be
performed, return `undefined`.

### `close`

    await handler.close();

This method is optional, and if present is called when a new
configuration is received, just before the old handler object will be
unreferenced. The result will be awaited before a new handler is
created. This should perform any cleanup (closing connections, etc.) and
ensure this is complete before the returned Promise resolves.

If and when the [TC39 Explicit Resource Management
proposal](https://github.com/tc39/proposal-explicit-resource-management)
is accepted and becomes available in Node.js, the `close` method is
likely to be supplemented by `Symbol.asyncDispose`. A handler object
implementing `@@asyncDispose` or `@@dispose` should clean up correctly
when any single disposal method is called.

