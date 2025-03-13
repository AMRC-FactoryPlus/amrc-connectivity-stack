/*
 * Factory+ NodeJS Utilities
 * Service interface base class.
 * Copyright 2022 AMRC.
 */

import * as content_type from "content-type";
import Optional from "optional-js";
import * as semver from "semver";

import { Service } from "../uuids.js";

const Names = Object.fromEntries(
    Object.entries(Service)
        .filter(([k, v]) => k != "Registry")
        .map(([n, u]) => [u, n]));

export class ServiceError extends Error {
    constructor (service, message, status) {
        super(message);
        this.service = service;
        this.status = status;
    }

    toString () {
        const srv = Names[this.service] ?? this.service;
        const st = this.status == undefined ? "" : `: ${this.status}`;
        return `${srv}: ${this.message}${st}`;
    }

    /** Check if an error is a ServiceError.
     * Returns a function which checks if an object is a ServiceError
     * with an appropriate status. This is intended to be used in the
     * .catch method of a Promise.
     * @param ok List of acceptable status codes. */
    static check (...ok) {
        return err => {
            if (!(err instanceof this))
                throw err;
            if (!ok.includes(err.status))
                throw err;
        };
    }
        
}

export function urljoin (...pieces) {
    return pieces.map(encodeURIComponent)
        .join("/");
}

export class ServiceInterface {
    constructor (fplus) {
        this.fplus = fplus;
        this.debug = fplus.debug;
    }

    throw (message, status) {
        throw new ServiceError(this.service, message, status);
    }

    async fetch (opts) {
        if (typeof opts == "string")
            opts = { url: opts };

        const body = "body" in opts ? JSON.stringify(opts.body) : undefined;

        const headers = { ...opts.headers };
        headers["Accept"] = opts.accept ?? "application/json";
        if (body)
            headers["Content-Type"] = opts.content_type ?? "application/json";

        opts = {
            ...opts,
            service:    this.service,
            headers,
            body,
        };
        const res = await this.fplus.fetch(opts);
        /* ?? here because Optional.or doesn't work properly */
        const json = Optional.of(opts.method ?? "GET")
            .filter(m => m != "HEAD")
            .map(_ => res.headers.get("Content-Type"))
            .map(content_type.parse)
            .filter(ct => ct.type == "application/json")
            .map(_ => res.json())
            .orElse(undefined);

        /* We are only interested in strong etags in the form of a UUID */
        const etag = Optional
            .ofNullable(res.headers.get("ETag"))
            .map(et => 
                /^"([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})"$/.exec(et))
            .map(m => m[1])
            .orElse(undefined);

        return [res.status, await json, etag];
    }

    async ping () {
        const [st, ping] = await this.fetch("/ping");
        if (st != 200) return;
        return ping;
    }

    /* XXX We should cache this information. HTTP Cache-Control is
     * likely to be set fairly short so won't help much. Knowing when to
     * invalidate the cache is tricky; the best answer is to extend the
     * WS protocol, but that would only really be available in
     * rx-client. (I think what I'm really saying here is 'HTTP isn't
     * really good enough for our needs'...) */
    async version_satisfies (range) {
        const ping = await this.ping();
        return semver.satisfies(ping.version, range);
    }

    async load_dump (dump) {
        const [st] = await this.fetch({
            method:     "POST",
            url:        "load",
            body:       dump,
        });
        if (st == 200) return;
        this.throw("Failed to load dump", st);
    }

    /* This always authenticates the WS */
    websocket (url) {
        return this.fplus.Fetch.ws_with_auth({
            service:    this.service,
            url,
        });
    }
}
