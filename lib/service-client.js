/*
 * Factory+ NodeJS Utilities
 * Service client library.
 * Copyright 2022 AMRC
 */

import { Debug } from "./debug.js";
import { Service } from "./uuids.js";

import Auth from "./service/auth.js";
import CmdEsc from "./service/cmdesc.js";
import ConfigDB from "./service/configdb.js";
import Directory from "./service/directory.js";
import Discovery from "./service/discovery.js";
import Fetch from "./service/fetch.js";
import Git from "./service/git.js";
import MQTTInterface from "./service/mqtt.js";

function opts_from_env (env) {
    const opts = `
        AUTHN_URL
        CONFIGDB_URL
        DIRECTORY_URL
        MQTT_URL
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

        this.debug = new Debug(opts);
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
    ["Auth", Auth, `check_acl fetch_acl resolve_principal`],
    ["CmdEsc", CmdEsc, ``],
    ["ConfigDB", ConfigDB, `fetch_configdb:get_config`],
    ["Directory", Directory, ``],
    ["Discovery", Discovery,
        `set_service_url set_service_discovery service_url service_urls`],
    ["Fetch", Fetch, `fetch`],
    ["Git", Git, ``],
    ["MQTT", MQTTInterface, `mqtt_client`],
);
