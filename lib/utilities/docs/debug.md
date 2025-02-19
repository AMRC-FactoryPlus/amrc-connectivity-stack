# Debug logging support

```js
import { Debug } from "@amrc-factoryplus/utilities";
```

This class implements simple configurable logging. All logs go to `console.log`.

Log messages are sent to a certain 'level', which is a user-defined category identified by a string. The `VERBOSE` environment variable can be set to a comma-separated list of levels to control which messages are printed and which are ignored.

## Constructor

```js
const debug = new Debug({
        verbose: "...",
        default: "...",
    })
```

Build a new logger. The `verbose` parameter overrides the `VERBOSE` environment variable, which overrides the `default` parameter. The final value can be either:

* A comma-separated list of level names. All listed levels will be logged; any other levels will be ignored.
* The string `"1"`, which requests logging all messages regardless of level.

## Methods

### log

```js
debug.log(level, message, ...args);
```

Send a log message. The level name will be prepended, to help with filtering. The message and args are passed to `util.format`.
