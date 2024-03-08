/*
 * Factory+ NodeJS Utilities
 * ConfigDB service interface.
 * Copyright 2022 AMRC.
 */

import format from "util";

import { App, Service, Null as Null_UUID } from "../uuids.js";

import { ServiceInterface } from "./service-interface.js";

export default class ConfigDB extends ServiceInterface {
    constructor (fplus) {
        super(fplus);
        this.service = Service.ConfigDB;
        this.log = this.debug.log.bind(this.debug, "configdb");
    }
    
    async get_config_with_etag (app, obj) {
        const [st, json, etag] = await this.fetch(`v1/app/${app}/object/${obj}`);
        if (st == 404) return [];
        if (st != 200)
            this.throw(`Can't get ${app} for ${obj}`, st);
        return [json, etag];
    }

    async get_config (app, obj) {
        const [json] = await this.get_config_with_etag(app, obj);
        return json;
    }

    async get_config_etag (app, obj) {
        const [st, , etag] = await this.fetch({
            method:     "HEAD",
            url:        `v1/app/${app}/object/${obj}`,
        });
        if (st == 404) return;
        if (st != 200)
            this.throw(`Can't get ${app} for ${obj}`, st);
        return etag;
    }

    async put_config (app, obj, json) {
        const [st] = await this.fetch({
            method:     "PUT",
            url:        `/v1/app/${app}/object/${obj}`,
            body:       json,
        });
        if (st == 204 || st == 201) return;
        this.throw(`Can't set ${app} for ${obj}`, st);
    }

    async delete_config (app, obj) {
        const [st] = await this.fetch({
            method:     "DELETE",
            url:        `/v1/app/${app}/object/${obj}`,
        });
        if (st == 204) return;
        this.throw(`Can't remove ${app} for ${obj}`, st);
    }

    async patch_config (app, obj, type, patch) {
        if (type != "merge")
            this.throw(`Only merge-patch supported`);

        const [st] = await this.fetch({
            method:         "PATCH",
            url:            `/v1/app/${app}/object/${obj}`,
            body:           patch,
            content_type:   "application/merge-patch+json",
        });
        if (st == 204) return;
        this.throw(`Can't patch ${app} for ${obj}`, st);
    }

    async list_configs (app) {
        const [st, json] = await this.fetch(`v1/app/${app}/object`);
        if (st == 404) return;
        if (st != 200)
            this.throw(`Can't list objects for ${app}`, st);
        return json;
    }

    /** Create a new object.
     *
     * @param klass The class of the new object. Required.
     * @param obj The UUID of the new object. Optional.
     * @param excl Fail if the object already existed.
     * @return The UUID of the new object.
     */
    async create_object (klass, obj, excl) {
        const [st, json] = await this.fetch({
            method:     "POST",
            url:        `/v1/object`,
            body:       {
                "class":    klass,
                uuid:       obj,
            },
        });
        if (st == 200 && excl)
            this.throw(`Exclusive create of ${obj} failed`);
        if (st == 201 || st == 200)
            return json.uuid;
        if (obj)
            this.throw(`Creating ${obj} failed`, st);
        else
            this.throw(`Creating new ${klass} failed`, st);
    }

    /* This should not normally be used by automated processes */
    async delete_object (obj) {
        const [st] = await this.fetch({
            method:     "DELETE",
            url:        `/v1/object/${obj}`,
        });
        if (st == 204) return;
        this.throw(`Deleting ${obj} failed`, st);
    }

    /* This is currently the recommended way to 'delete' an object. This
     * will NOT delete any config entries, the caller will have to
     * handle that.
     *
     * This flag is advisory and for human consumption only. Don't
     * attempt to read it from services. */
    mark_object_deleted (obj) {
        return this.patch_config(App.Info, obj, "merge",
            { deleted: true });
    }

    async search (...args) {
        const opts = args.length == 3
            ? { app: args[0], query: args[1], results: args[2] }
            : args[0];

        const klass = opts.klass ? `/class/${opts.klass}` : "";
        const qs = Object.fromEntries([ 
            ...Object.entries(opts.query)
                .map(([k, v]) => [k, JSON.stringify(v)]),
            ...Object.entries(opts.results ?? {})
                .map(([k, v]) => [`@${k}`, v]),
        ]);

        const res = await this.fplus.fetch({
            service:    Service.ConfigDB,
            url:        `/v1/app/${opts.app}${klass}/search`,
            query:      qs,
        });
        if (!res.ok)
            this.throw("search failed", res.status);
        return await res.json();
    }

    async resolve (opts) {
        if ("results" in opts)
            this.throw("resolve doesn't return results");

        const uuids = await this.search(opts);

        if (!Array.isArray(uuids))
            this.throw("search didn't return an array");
        if (uuids.length > 1)
            this.throw(format("More than one result resolving %s with %o",
                opts.app, opts.query));

        return uuids[0];
    }

    /* Returns a Promise to a watcher object. */
    async watcher () {
        if (!this._watcher) {
            const fplus = this.fplus;

            const [watcher, spapp, info] = await Promise.all([
                import("./configdb-watcher.js"),
                fplus.MQTT.sparkplug_app(),
                fplus.Directory.get_service_info(this.service),
            ]);

            const dev = await spapp.device({ device: info.device });
            this._watcher = new watcher.ConfigDBWatcher(this, dev);
        }
        return this._watcher;
    }
}
