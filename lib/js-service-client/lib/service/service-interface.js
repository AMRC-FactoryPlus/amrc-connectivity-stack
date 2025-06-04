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

/** Exception class for a service error. */
export class ServiceError extends Error {
    constructor (service, message, status) {
        super(message);
        /** The service UUID of the service that produced the error. */
        this.service = service;
        /** The HTTP status code returned.
         * 0 is returned for connection problems. */
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

/** Join all arguments into a URL path.
 * URL-encodes each argument as a path component and joins with `/`.
 */
export function urljoin (...pieces) {
    return pieces.map(encodeURIComponent)
        .join("/");
}

/** The base class for the service interface objects. 
 * In general interface methods handle expected HTTP errors and throw
 * ServiceError for others.
 */
export class ServiceInterface {
    /** The constructor is private.
     * Construct via a ServiceClient. */
    constructor (fplus) {
        this.fplus = fplus;
        this.debug = fplus.debug;
    }

    /** Throw a ServiceError.
     * @arg message The error message.
     * @arg status The HTTP status to report.
     */
    throw (message, status) {
        throw new ServiceError(this.service, message, status);
    }

    /** Make a request to this service.
This calls Fetch.fetch with some additional functionality.

- We supply the `service` parameter.
- A single string argument will be used as the `url` parameter.
- If `body` is supplied it will be JSON-encoded.
- Content-Type and Accept default to `application/json`.
- A JSON response body will be decoded.
- A strong ETag which is a UUID will be returned.

@returns [status, body, etag]
*/
    async fetch (opts) {
        if (typeof opts == "string")
            opts = { url: opts };
        let body;
        if("body" in opts && opts.content_type === "raw") {
            body = opts.body;
        }else {
            body = JSON.stringify(opts.body);
        }

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

        /* We are only interested in strong etags in the form of a UUID */
        const etag = Optional
            .ofNullable(res.headers.get("ETag"))
            .map(et => 
                /^"([0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})"$/.exec(et))
            .map(m => m[1])
            .orElse(undefined);

        if(res.headers.get("Content-Type") === "application/octet-stream"){
            return [res.status, res.body, etag]
        }else{
            /* ?? here because Optional.or doesn't work properly */
            const json = Optional.of(opts.method ?? "GET")
                .filter(m => m != "HEAD")
                .map(_ => res.headers.get("Content-Type"))
                .map(content_type.parse)
                .filter(ct => ct.type == "application/json")
                .map(_ => res.json())
                .orElse(undefined);
            return [res.status, await json, etag];

        }
    }

    /** Call /ping and return the result. */
    async ping () {
        const [st, ping] = await this.fetch("/ping");
        if (st != 200) return;
        return ping;
    }

    /** Call /ping and check the service version.
     * Returns undefined if the service can't be contacted.
     * @arg range A semver version range string.
     * @returns True, false or undefined.
     */
    /* XXX We should cache this information. HTTP Cache-Control is
     * likely to be set fairly short so won't help much. Knowing when to
     * invalidate the cache is tricky; the best answer is to extend the
     * WS protocol, but that would only really be available in
     * rx-client. (I think what I'm really saying here is 'HTTP isn't
     * really good enough for our needs'...) */
    async version_satisfies (range) {
        const ping = await this.ping();
        if (!ping) return;
        return semver.satisfies(ping.version, range);
    }

    /** Load a dump into this service.
     * The dump must be complete, including the `service` property.
     * @arg dump A JS object representing a service dump.
     */
    async load_dump (dump) {
        const [st] = await this.fetch({
            method:     "POST",
            url:        "load",
            body:       dump,
        });
        if (st == 200) return;
        this.throw("Failed to load dump", st);
    }

    /** Open a websocket to this service.
     * This will carry out the authentication protocol defined for the
     * notify/v2 interface.
     * @arg url The path for the websocket.
     */
    websocket (url) {
        return this.fplus.Fetch.ws_with_auth({
            service:    this.service,
            url,
        });
    }
}
