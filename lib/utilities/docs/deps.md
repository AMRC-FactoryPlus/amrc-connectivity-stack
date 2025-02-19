# Third-party modules

The library imports and re-exports certain third-party modules likely to be useful across Factory+ services. This is partly for convenience and partly to abstract out dependencies which may need to change in the future.

## GSSAPI

```js
import { GSS } from "@amrc-factoryplus/utilities";
```

This is an export of the `gssapi.js` npm module, which provides an interface to the Kerberos library. On Windows `GSS` can be imported, but imports as `undefined`, as we currently don't support GSSAPI on Windows.

- [Official GSSAPI Documentation](https://www.npmjs.com/package/gssapi.js)

## MQTT

```js
import { MQTT } from "@amrc-factoryplus/utilities";
```

This is a straight re-export of the `mqtt` npm module.

- [Official MQTT.js Documentation](https://www.npmjs.com/package/mqtt)

## Sparkplug

```js
import { SpB } from "@amrc-factoryplus/utilities";
```

This is a re-export of the Sparkplug B v1.0 payload decoder from the official `sparkplug-payload` Javascript library.

- [Official SparkplugB Documentation](https://www.npmjs.com/package/sparkplug-payload)

## Postgres

```js
import { Pg } from "@amrc-factoryplus/utilities";
```

This is a re-export of the native bindings to the Postgresql client libraries. The Docker images ensure that these have been build with GSSAPI support, allowing the client to use Factory+ Kerberos credentials to access the database.

- [Official Node Postgres Documentation](https://node-postgres.com/features/native)

## Fetch

```js
import { fetch } from "@amrc-factoryplus/utilities";
```

This is an implementation of the Fetch API. Currently this is provided by `got-fetch`, as this is the only implementation available for Node which provides correct caching support; this may change in the future, especially if Node provides a native implementation.

- [Official Fetch API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)
- [Implementation Details](https://www.npmjs.com/package/got-fetch)
