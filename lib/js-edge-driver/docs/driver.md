# Generic driver interface

The drivers provided by the library are derived from a common base
class. This supports connection to the Edge Agent and communication
with the user-provided handler class.

## Outline

The basic structure of any driver using this library looks like this:

    /* Import an appropriate subclass */
    import { Driver } from "@amrc-factoryplus/edge-driver";

    /* This implements the driver functionality */
    class Handler {
        /* This is called to construct a handler */
        static create (driver, conf) { }

        /* This method is required */
        connect () { }

        /* These properties and methods are optional */
        static validAddrs;
        parseAddr (addr) { }
        async subscribe (specs) { }
        async close () { }
    }
    
    /* Don't use Driver directly, use a subclass */
    const drv = new Driver({
        env:        process.env,
        handler:    Handler,
    });
    drv.run();

A handler class is required; this implements the driver functionality
and must support the interface required by the Driver subclass in use.
Then a generic driver object is created passing the handler class. Every
time the Edge Agent sends a new config, the library will destroy the
current handler and create a new one. The driver will then call the
`connect` method on the handler which should attempt to connect to the
southbound device. The handler reports connection status and received
data by calling methods on the driver.

The driver object needs access to the process environment to communicate
with the Edge Agent; this assumes the standard environment variables are
being used.

The documented API is detailed below. Any other methods or properties
are not documented and must not be relied on.

## `Driver` class

A `Driver` object represents the whole driver process, and handles
communication with the Edge Agent. The class Driver itself should be
considered abstract; create instances of subclasses. Methods documented
below can be called from the handler class.

### `constructor`

    const driver = new Driver({
        env:        process.env,
        handler:    HandlerClass,
    });

The `env` property should be `process.env`, or a suitable substitute.
The keys `EDGE_MQTT`, `EDGE_USERNAME` and `EDGE_PASSWORD` will be used
to initiate communication with the Edge Agent. The key `VERBOSE` will be
used to configure the logger.

The `handler` property specifies the handler class to implement the
functionality of this driver. This must support the interface required
by the Driver subclass in use, which will be a subinterface of the
`Handler` interface below.

### `debug`

    driver.debug.log(channel, message);

This property is a [Debug object](./debug.md) configured from the
environment. The handler class should use this for logging.

### `run`

    driver.run();

This method starts the communication with the Edge Agent. It does not
return.

### `connUp`

    driver.connUp();

This should be called by the handler to report that the connection to
the southbound device has been successfully established. If the handler
`connect` method returns a Promise then this method should not be used.

### `connFailed`

    driver.connFailed();

This should be called by the handler to report that the connection to
the southbound device has failed. The handler should not call this
unless it has previously returned `UP` from the `connect` method. The
handler should not attempt to reconnect or produce any more data until
the driver has reconnected.

### `connUnauth`

    driver.connUnauth();

This should be called by the handler to report an authentication problem
with the southbound device. This should only be called in the same
circumstances as `connFailed`.

### `reconnect`

    driver.reconnect = 5000;

This property can be set by the handler to adjust the the reconnection
delay. The default is 5000 (5 seconds).

## `Handler` interface

The handlers required by Driver subclasses all need to implement this
interface, in addition to any further requirement imposed by the
subclass.

### `create`

    const handler = HandlerClass.create(driver, conf);

This is a static method called to construct a handler object. The method
is passed the driver object this handler belongs to and the
configuration received from the Edge Agent. The method should validate
the configuration and return `undefined` if it is invalid. Otherwise it
should construct and return a handler object.

This method should not attempt to connect to the southbound device.

### `connect`

    handler.connect();
    const status = await handler.connect();

This is called by the driver to initiate connection to the southbound
device. This method may either return `undefined` or a Promise to a
string.

An undefined return value requests use of the callback API; the connect
method must subsequently call one of the `conn...` method on the Driver
to report the connection status. A Promise return value must resolve to
a string, one of `"UP"`, `"CONN"`, or `"AUTH"`, to report the connection
status directly.

If the connection is reported as having failed the driver will call
`connect` again after a delay. The handler is responsible for ensuring
any previous connection is cleaned up properly.

### `validAddrs`

    const valid = HandlerClass.validAddrs.get(addr);

This property is optional.

If a handler class has this property, it should be a Set of strings
indicating valid addresses. This is only suitable for drivers which have
a fixed set of constant addresses, but can be used instead of a
`parseAddr` method which only validates.

### `parseAddr`

    const spec = handler.parseAddr(addr);

This method is optional.

This method parses an address string and returns a data structure
suitable for the handler's internal purposes. This will be passed to the
driver later in place of the address. This method may be called at any
time; in particular it may be called before the handler has connected. 

The string should be validated for syntax, but no IO can be performed.
This method should be a pure function: it should produce the same result
every time for the same argument. If this method is not provided then
address strings are passed through as-is.

### `subscribe`

    await handler.subscribe(specs);

This method is optional.

If this method exists it will be called whenever the Edge Agent has
changed the list of addresses it is interested in. The method is passed
an Array of specs as returned from `parseAddr`. The handler can use this
to set up subscriptions to the southbound device.

### `cmd`

	await handler.cmd(commandName, data);

This method is optional.

If this method exists it is called whenever the device is sent a CMD.
The method is passed the name of the command and the data object, which
is a buffer. It is the responsibility of the southbound driver to parse
the buffer depending on the command.

### `close`

    await handler.close();
    handler.close(done);

This method is optional.

If this method exists it is called when a new configuration is received,
just before the old handler object will be unreferenced. The method should
perform any cleanup (closing connections, etc.) needed before
reconnecting.

The method supports both Promise-based and callback-based APIs. The
method is passed a callback, which can be called to indicate cleanup is
finished. Alternatively the method can return a Promise.

