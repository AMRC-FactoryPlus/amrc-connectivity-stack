#!/usr/bin/env node

/*
 * ACS Gateway Depot
 * Main entry point.
 * Copyright 2026 University of Sheffield AMRC
 */

import path     from "path";
import url      from "url";

import { RxClient }     from "@amrc-factoryplus/rx-client";
import { WebAPI }       from "@amrc-factoryplus/service-api";

import { Clusters }         from "../lib/clusters.js";
import { Service }          from "../lib/constants.js";
import { Depot }            from "../lib/depot.js";
import { GIT_VERSION }      from "../lib/git-version.js";
import { Payload }          from "../lib/payload.js";
import { PUBLIC, routes }   from "../lib/routes.js";
import { Store }            from "../lib/store.js";

const { env } = process;
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

console.log("Running Gateway Depot revision %s", GIT_VERSION);

const fplus = await new RxClient({ env }).init();

const payload = new Payload({
    fplus,
    gateway_dir:    env.GATEWAY_DIR ?? path.join(root, "gateway"),
    k3s_dir:        env.K3S_DIR ?? path.join(root, "k3s"),
}).init();

const store = await new Store({ fplus }).init();
const clusters = new Clusters({ fplus });

const depot = new Depot({
    fplus, store, clusters, payload,
    /* The address gateways call us on. */
    public_url:     env.PUBLIC_URL.replace(/\/+$/, ""),
    has_ca:         env.GATEWAY_CA == "true",
    /* Site settings every gateway gets. */
    defaults: {
        registry_mirror:        env.REGISTRY_MIRROR ?? "",
        apt_mirror:             env.APT_MIRROR ?? "",
        apt_mirror_key_sha256:  env.APT_MIRROR_KEY_SHA256 ?? "",
        apt_mirror_origin:      env.APT_MIRROR_ORIGIN ?? "",
        admin_user:             env.ADMIN_USER || "fplus",
        locale:                 env.GATEWAY_LOCALE || "en_GB.UTF-8",
        keyboard:               env.GATEWAY_KEYBOARD || "gb",
        timezone:               env.GATEWAY_TIMEZONE || "Europe/London",
    },
}).init();

const api = await new WebAPI({
    ping: {
        version:    "1.0.0",
        service:    Service.GatewayDepot,
        software: {
            vendor:         "AMRC",
            application:    "acs-gateway-depot",
            revision:       GIT_VERSION,
        },
    },
    debug:      fplus.debug,
    realm:      env.REALM,
    hostname:   env.HOSTNAME,
    keytab:     env.SERVER_KEYTAB,
    http_port:  env.PORT,
    max_age:    env.CACHE_MAX_AGE,
    public:     PUBLIC,
    /* We check the caller's permission ourselves and then act with our
     * own rights, so don't pass a caller's JWT on to other services. */
    forward_jwt:    false,
    routes:     routes({ fplus, depot, payload }),
}).init();

api.run();
