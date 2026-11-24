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
        static scouts;
        async scout (req, out) { }
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

Only one of `cmd` and `write` is called. If the handler class sets
`typedWrites`, the driver subscribes to typed writes and `cmd` is never
called.

### `typedWrites`

    class MyHandler {
        static typedWrites = true;
        ...
    }

This property is optional, and needs an Edge Agent from November 2026
or later.

If a handler class sets this static property to `true`, the driver
subscribes to typed writes and calls `write` instead of `cmd`. Without
it the driver behaves as before, even if the handler has a method
called `write` for its own use.

### `write`

    await handler.write(spec, type, value);

This method is called only when the handler class sets `typedWrites`.
It receives each typed write instead of `cmd`. The method is passed the address spec as returned from
`parseAddr`, the metric's Sparkplug type as a string (`"Int16"`,
`"Float"`, `"String"` and so on) and the value as a JS value:

Type|Value
---|---
Boolean|boolean
Int8, Int16, Int32, UInt8, UInt16, UInt32|number
Int64, UInt64|BigInt
Float, Double|number, which may be NaN or infinite
String, Text, UUID|string
DateTime|number of milliseconds since the epoch

If the write fails, throw (or return a rejected Promise). The driver
reports it to the Edge Agent on the address's `err` topic. An error
whose `code` property is `RO`, `CMD` or another code from the protocol
is reported with that code, and any other error as `ERR`. A typed write
that doesn't fit its type, or that names an address not in the current
address configuration, is reported as `CMD` without calling the method.

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

### `scouts`

    class MyHandler {
        static scouts = true;
        ...
    }

This property is optional, and needs an Edge Agent with Edge Scout.

If a handler class sets this static property to `true`, the driver
tells the Edge Agent that it can list its device's addresses, and calls
`scout` when an operator presses Scan in the Admin UI. Without it the
driver answers every scan with `UNSUPPORTED`, even if the handler has a
method called `scout`. The answer comes from the class, so a driver
whose configuration failed still answers correctly.

### `scout`

    const end = await handler.scout(req, out);

This method is called only when the handler class sets `scouts`. It
lists the addresses the southbound device offers. The protocol is the
"Scouting" section of `acs-edge/docs/edge-split.md`, and the library
does all of it except producing items: the subscription, the hello,
`seq`, batching, the limits, the time limit, cancel and errors.

`req` has these properties:

Property|Meaning
---|---
`root`|Where to start, in the driver's own terms, or null for the device's natural top
`folder_id`|For a branch scan, the `id` of the folder it replaces, or null. The first item must have this `id`
`options`|Driver-specific options, an object, which the handler checks
`limits`|`items`, `depth`, `seconds`, `pace_ms` and `samples`, already clamped

`out` has these properties:

Property|Meaning
---|---
`add(items)`|Queue an item or an array of items. Returns a Promise that resolves when they are queued, so a handler slows to the speed of the broker. It rejects with `ScoutStopped` once the scan has stopped
`progress({visited, note})`|Record how far the scan has got. The library sends progress at least every 5 s, with `found` counted from the items added
`pace()`|Returns a Promise that resolves after `limits.pace_ms`. Await it between southbound requests
`signal`|An `AbortSignal` that aborts when the scan stops: on cancel, on a new configuration, at the item cap or at the time limit
`limits`|The same as `req.limits`

Each item is an object, as the protocol describes:

    { id: "ns=2;s=Line1/Speed", parent: "ns=2;s=Line1", name: "Speed",
      kind: "value", address: "ns=2;s=Line1/Speed", path: null,
      type: "Double", access: "rw", unit: "rpm" }

The `id` must come from the device alone, never from the scan's root,
so a node has the same `id` in a full scan and in a branch scan. A
value's `address` must be in the form the driver's own address parser
accepts and prints.

Return an object with these properties, all optional:

Property|Meaning
---|---
`exhaustive`|`true` when the scan found everything there is, within its caps
`truncated`|`true` when a cap of the handler's own stopped the scan
`reason`|With `truncated`: `items`, `depth`, `seconds`, `size` or `partial_access`
`excluded`|Up to 8 parts of the device the scan skipped on purpose, as `{id, reason, prefixes}`

To fail the scan, throw `ScoutError` with a code:

    import { ScoutError } from "@amrc-factoryplus/edge-driver";
    throw new ScoutError("OPTIONS", `Root ${req.root} does not exist`);

The codes are `OPTIONS` for a bad `root`, `folder_id` or option, and
`CONN` or `AUTH` when the device can't be reached or refuses the
driver. Anything else thrown ends the scan with `ERR` and its message.

The library also keeps to the limits itself, so a handler that misses
one still ends the scan correctly:

* At the item cap `out.add` rejects, and the scan ends truncated with
  reason `items`.
* Items deeper than `limits.depth` are dropped, and the scan ends
  truncated with reason `depth`.
* At `limits.seconds` the scan ends truncated with reason `seconds`,
  even if `scout` never returns.
* A cancel or a new configuration ends the scan with `CANCELLED`.
* Items without an `id`, and `sample` unless `limits.samples` is set,
  are left out.

After the scan has stopped, `scout` has 2 s to return before the
library ends the scan without it. Only one scan runs at a time.
