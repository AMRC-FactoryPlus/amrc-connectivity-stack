/*
 * ACS service setup
 * An in-memory ConfigDB for the split driver tests
 * Copyright 2026 University of Sheffield AMRC
 */

import { ServiceError, UUIDs } from "@amrc-factoryplus/service-client";

/* A copy of a JSON value with its object keys in the order Postgres
 * `jsonb` returns them, which the ConfigDB stores: shorter keys first,
 * then by bytes. So `{privileged, image}` comes back `{image,
 * privileged}`. */
export function jsonb (value) {
    if (Array.isArray(value)) return value.map(jsonb);
    if (value === null || typeof value != "object") return value;
    const bytes = k => Buffer.from(k, "utf8");
    return Object.fromEntries(Object.keys(value)
        .filter(k => value[k] !== undefined)
        .sort((a, b) => bytes(a).length - bytes(b).length
            || Buffer.compare(bytes(a), bytes(b)))
        .map(k => [k, jsonb(value[k])]));
}

/* An in-memory ConfigDB with the calls the step makes. Every write is
 * recorded. `stale` lists [app, obj] writes to refuse once with 412. */
export class FakeCDB {
    constructor () {
        this.configs = new Map();
        this.writes = [];
        this.versions = new Map();
        this.stale = [];
    }

    app (a) {
        if (!this.configs.has(a)) this.configs.set(a, new Map());
        return this.configs.get(a);
    }
    set (a, o, c) {
        this.app(a).set(o, jsonb(c));
        const k = `${a}/${o}`;
        this.versions.set(k, (this.versions.get(k) ?? 0) + 1);
    }
    get (a, o) { return structuredClone(this.app(a).get(o)); }

    async get_all_configs (a) { return new Map(structuredClone([...this.app(a)])); }
    async get_config_with_etag (a, o) {
        if (!this.app(a).has(o)) return [];
        return [this.get(a, o), String(this.versions.get(`${a}/${o}`))];
    }
    async put_config (a, o, c, opts) {
        const i = this.stale.findIndex(([sa, so]) => sa == a && so == o);
        if (i >= 0) {
            this.stale.splice(i, 1);
            /* Someone else saved it in between. */
            this.set(a, o, this.get(a, o));
            throw new ServiceError(UUIDs.Service.ConfigDB, "Stale", 412);
        }
        if (opts?.etag && opts.etag != String(this.versions.get(`${a}/${o}`)))
            throw new ServiceError(UUIDs.Service.ConfigDB, "Stale", 412);
        this.writes.push({ app: a, obj: o, config: structuredClone(c) });
        this.set(a, o, c);
    }
}
