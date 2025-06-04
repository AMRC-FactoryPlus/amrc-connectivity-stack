/*
 * Factory+ NodeJS Utilities
 * Service client library.
 * Copyright 2022 AMRC
 */

import { Debug } from "./debug.js";

import * as SI from "./interfaces.js";

function opts_from_env (env) {
    const opts = `
        AUTHN_URL
        CONFIGDB_URL
        DIRECTORY_URL
        MQTT_URL
        BOOTSTRAP_ACL
        ROOT_PRINCIPAL
        SERVICE_USERNAME:username
        SERVICE_PASSWORD:password
        VERBOSE
    `   .split(/\s+/)
        .map(v => v.includes(":") ? v.split(":") : [v, v.toLowerCase()])
        .filter(v => v[0] in env)
        .map(v => [v[1], env[v[0]]]);
    return Object.fromEntries(opts);
}

/** Main interface to the Factory+ services.
This object exists to create service interface objects for the
different Factory+ services. The object itself holds configuration
about our connection to Factory+.

Service interface objects are available as properties of the
ServiceClient. These are constructed lazily as they are needed. The
following interfaces are available:

- Auth
- CmdEsc
- ConfigDB
- Directory
- Discovery
- Fetch
- Git
- MQTT

All service interfaces inherit from {ServiceInterface}.
*/
export class ServiceClient {
/** Build a new ServiceClient.

Accepts an object of options. These are all made available to the
service interfaces; see the interface documentation for more details.
All interfaces use these options:

- `directory_url`: The URL of the Directory, to start discovery.
- `username`: The username to use (optional).
- `password`: The password to use (optional).
- `verbose`: Used to configure a Debug object.
- `browser`: Must be set to true if we are running in a browser.

All interfaces will be affected by the Discovery and Fetch options. If
`username` or `password` are not set we will attempt to use GSSAPI
authentication, meaning `KRB5CCNAME` must be set to the name of a valid
ccache. Autodetection of a browser environment is not reliable so this
must be specified explicitly.

If the option `env` is given it is expected to hold an object of
environment variables like `process.env`. If the following
variables are set they will be used as defaults:

    AUTHN_URL
    CONFIGDB_URL
    DIRECTORY_URL
    MQTT_URL
    BOOTSTRAP_ACL
    ROOT_PRINCIPAL
    SERVICE_USERNAME
    SERVICE_PASSWORD
    VERBOSE
*/ 
    constructor (opts) {
        opts ??= {};
        this.opts = "env" in opts
            ? { ...opts_from_env(opts.env), ...opts }
            : opts;
        delete this.opts.env;

        /** A {Debug} object. */
        this.debug = new Debug(this.opts);
    }

    /** This is obsolete and just returns `this`. */
    async init () {
        return this;
    }

    /** Create a ServiceClient which doesn't use the cache.
     * @returns A new ServiceClient with `cache: "no-cache"`
     */
    uncached () {
        return new this.constructor({
            ...this.opts,
            cache: "no-cache",
        });
    }

    static define_interfaces (...interfaces) {
        for (const [name, klass, methlist] of interfaces) {
            Object.defineProperty(this.prototype, name, {
                configurable: true,
                get () { return this[`_${name}`] ??= new klass(this); },
            });

            const meths = methlist.split(/\s+/).filter(s => s.length);
            for (const meth of meths) {
                const [mine, theirs] = meth.split(":");
                Object.defineProperty(this.prototype, mine, {
                    configurable: true,
                    writable: true,
                    value (...args) { 
                        return this[name][theirs ?? mine](...args);
                    },
                });
            }
        }
    }
}

/* The methods delegeted here from the ServiceClient should be
 * considered backwards-compatible shims. Future service methods will
 * mostly be defined only on the service interface. */
ServiceClient.define_interfaces(
    ["Auth", SI.Auth, `check_acl fetch_acl resolve_principal`],
    ["CmdEsc", SI.CmdEsc, ``],
    ["ConfigDB", SI.ConfigDB, `fetch_configdb:get_config`],
    ["Directory", SI.Directory, ``],
    ["Discovery", SI.Discovery,
        `set_service_url set_service_discovery service_url service_urls`],
    ["Fetch", SI.Fetch, `fetch`],
    ["Git", SI.Git, ``],
    ["MQTT", SI.MQTTInterface, `mqtt_client`],
    ["Files", SI.Files, ``],
);
