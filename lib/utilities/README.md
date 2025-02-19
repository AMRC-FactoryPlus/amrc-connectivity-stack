> **Note**
> The AMRC Connectivity Stack is an open-source implementation of the AMRC's [Factory+ Framework](https://factoryplus.app.amrc.co.uk/).

This is a NodeJS library for writing clients for Factory+. It was used
extensively when building the AMRC Connectivity Stack. This library is
now being cut down into a compatibility shim for existing code; new code
trying to consume Factory+ services should use
`@amrc-factoryplus/service-client` instead.

## Compatibility

Version 2.0.0 of this package has broken backwards compatibility as
follows:

* The method `basic_sparkplug_node` on the MQTT interface now returns a
  Promise and must be awaited. 
* The Debug class no longer reads `VERBOSE` from the environment, the
  option must be supplied explicitly.
* The WebAPI class now requires a `verbose` option to enable logging.

Further versions in the 2.x series are intended only to support the
existing ACS codebase and may break backwards compat further as needed
to migrate the code out into other packages. If you need functionality
from this package which is not provided by
`@amrc-factoryplus/service-client`, please speak to us first.

## Getting Started

This library has native code dependencies: it requires GSSAPI libraries
and (for ACS use) a Postgres library built with GSSAPI support. The most
straightforward way to meet these is to build a Docker image using the
base images from the ACS repository. See that repository for example
Dockerfiles.

## Using the package

This module is an ESM-only module; it cannot be loaded with `require`. If you are writing ESM code (if you
have `"type": "module"` in your`package.json`, or if you are using `.mjs` file extensions) then you can load the module
like this:

```js
import * as factoryplus from "@amrc-factoryplus/utilities";

// or

import { WebAPI } from "@amrc-factoryplus/utilities";
```

If you are using CommonJS (using `require` to load modules) you will need to use:

```js
const factoryplus = await import("@amrc-factoryplus/utilities");
```

Be aware that because you can't do top-level `await` in CommonJS you will need to call this from within an `async` function. 

If you are using Typescript then the ESM import should work fine. There are currently no `.d.ts` files; feel free to submit a PR 😀!

## Exports

### Third-party libraries

```js
import { MQTT, GSS, Pg, SpB } from "@amrc-factoryplus/utilities";
```

These are re-exports of third party modules. They are re-exported here
partly to provide protection from future changes to the third-party
modules, and partly to work around bugs or problems with importing.

- [Full Third-Party Library Documentation](./docs/deps.md)

### Database access

```js
import { DB } from "@amrc-factoryplus/utilities";
```

A class for accessing a Postgres database. Provides basic transaction/retry support on top of the `pg` module.

- [Full Database Documentation](./docs/db.md)

### Logging

```js
import { Debug } from "@amrc-factoryplus/utilities";
```

Configurable logging support.

- [Full Debug/Logging Documentation](./docs/debug.md)

### Factory+ Service Client

```js
import { ServiceClient } from "@amrc-factoryplus/utilities";
```

This provides client access to the Factory+ service framework, including automatic support for service discovery and GSSAPI authentication.

- [Full Service Client Documentation](./docs/service-client.md)

### Sparkplug support

```js
import { 
    Address, Topic,
    MetricBuilder,
    MetricBranch, MetricTree,
} from "@amrc-factoryplus/utilities";
```

Utility classes for working with Sparkplug packets.

- [Full Sparkplug Utility Class Documentation](./docs/sparkplug-util.md)

### Miscellaneous utilities

```js
import {
    Version,
    resolve, pkgVersion,
    loadJsonObj, loadAllJson,
} from "@amrc-factoryplus/utilities";
```

- [Full Miscellaneous Utility Documentation](./docs/util.md)

### Well-known UUIDs

```js
import { UUIDs } from "@amrc-factoryplus/utilities";
```

Constants representing well-known UUIDs. For more information on the well-known UUIDs specified by Factory+ [refer to the Factory+ framework](https://factoryplus.app.amrc.co.uk).

### Web API boilerplate

```js
import { FplusHttpAuth, WebAPI } from "@amrc-factoryplus/utilities";
```

Classes useful in implementing an HTTP service confirming to the Factory+ spec.

- [Full Web API Documentation](./docs/webapi.md)

### Removed APIs

As of version 2.0.0 these exports have been removed:

* `debug` has been replaced by the Debug object.
* `secrets` provided support for reading from Docker secrets; since
  moving to Kubernetes this has been redundant.
* `gss_mqtt` connected to an MQTT server with GSSAPI authentication. It
  is better to use a ServiceClient instead, as this will discover the
  MQTT server via the Directory. If it is really necessary the MQTT URL
  can be overridden in the ServiceClient configuration.
* `fetch` has been removed as an export.

### Coding Style

| Language | Standard |
| -- | -- |
| Javascript | [AirBnB](https://github.com/airbnb/javascript) |

## Contributing

Development practice follows [GitHub flow](https://guides.github.com/introduction/flow/).
