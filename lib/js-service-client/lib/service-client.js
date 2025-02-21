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

export class ServiceClient {
    constructor (opts) {
        opts ??= {};
        this.opts = "env" in opts
            ? { ...opts_from_env(opts.env), ...opts }
            : opts;
        delete this.opts.env;

        this.debug = new Debug(this.opts);
    }

    async init () {
        return this;
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
);
