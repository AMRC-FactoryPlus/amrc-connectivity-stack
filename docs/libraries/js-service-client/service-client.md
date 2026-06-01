This module defines a `ServiceClient` class that acts as the main entry point to multiple Factory+ services (Auth, MQTT, ConfigDB, Discovery, etc.).

It's main purpose is to:
- collect configuration/options
- create service-specific clients lazily
- expose convenience wrapper methods
- standardise access to Factory+ services like Auth, MQTT, ConfigDB, etc.

# High-level architecture
```
ServiceClient
    ├── Auth interface
    ├── ConfigDB interface
    ├── Discovery interface
    ├── MQTT interface
    └── etc...
```

Instead of manually creating each service client: 
```
    const auth = new Auth(...)
    const mqtt = new MQTT(...)
```

You create one root client:
```
    const fplus = new ServiceClient(opts);
```
and then access services through properties:
```
    fplus.Auth
    fplus.MQTT
    fplus.ConfigDB
```
These interface objects are created only when first used ("lazy construction"). 

# Imports 
```
    import { Debug } from "./debug.js";
    import * as SI from "./interfaces.js";
```

### `Debug`
A debugging/logging helper class so every service interface can share common debugging behaviour. 

### * as SI
Imports *everything* from `interfaces.js` into the namespace `SI`.

So: 
```
    SI.AUTH
    SI.ConfigDB
    SI.Fetch
```
are classes exported from `interfaces.js`.

This is effectively a registry of all service interface classes. 

# `opts_from_env(env)`
```
    function opts_from_env(env)
```
This converts environment variables into normalized option names. 

### The mapping table
```
    const opts = `
        AUTHN_URL
        CONFIGDB_URL
        DIRECTORY_URL
        MQTT_URL
        BOOTSTRAP_ACL
        REALM
        ROOT_PRINCIPAL
        SERVICE_USERNAME:username
        SERVICE_PASSWORD:password
        VERBOSE
    `
```
Most entries map automatically:
```
    AUTHN_URL -> authn_url
    MQTT_URL -> mqtt_url
```

But some variables explicitly rename:
```
        SERVICE_USERNAME -> username
        SERVICE_PASSWORD -> password
```

Result: 
```
    {
        authn_url: "...",
        mqtt_url: "...",
        username: "...",
        ...
    }
```

# Key concept: lazy service creation
> Service interface objects are available as properties. 

Meaning:
```
    fplus.Auth
```
is not a plain value - it's a dynamically generated property. 


# Class `ServiceClient`
## Constructor
#### Environment merging
```
    this.opts = "env" in opts
        ? { ...opts_from_env(opts.env), ...opts }
        : opts;
```
If caller passes:
```
    new ServiceClient({
        env: process.env
    })
```
then: 
1. read defaults from environment variables
2. merge explicit options over them

Important precedence:
```
    { ...envOpts, ...opts }
```
means explicit constructor options override env vars. 

#### Remove `env`
```
    delete this.opts.env;
```
Because after processing, the raw env object is no longer needed. 

### Debug instance
```
    this.debug = new Debug(this.opts);
``` 
Attaches reusable debugging support to the client. 

## `init()`
```
    async init(){
        return this;
    }
```
This is backward compa