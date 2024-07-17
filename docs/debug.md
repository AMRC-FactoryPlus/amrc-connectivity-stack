# Debug class

    const debug = new Debug({ verbose: "ALL" });
    debug.log("foo", "message");

    const log = debug.bound("channel");
    log("message");

This is a simple configurable logging class, compatible with the class
used in `@amrc-factoryplus/service-client`. Log messages are categorised
by 'channel', and the logger configuration chooses which channels to
log.

Channel names are short strings defined by the section of code doing the
logging. Log messages are prefix with their channel name. 

## `constructor`

    const debug = new Debug({ verbose: process.env.VERBOSE });

The constructor accepts an object of options. The only valid option is
`verbose`, which should normally be set to the value of `VERBOSE`
environment variable. This should be a string consisting of a
comma-separated list of channel names.

Channels listed will have their messages logged. The channel `ALL`
requests all channels be logged; without this channels not listed will
not be logged. A channel name prefixed with `!` causes that channel to
be suppressed (not logged); a suppressed channel overrides a requested
channel.

## `log`

    debug.log(channel, format, ...args);

Log a message to a given channel. The `format` and `args` parameters are
passed to `util.format`. The message is preceded by the channel name and
a colon.

## `bound`

    const log = debug.bound(channel);

Returns a log function pre-bound to a particular channel.
