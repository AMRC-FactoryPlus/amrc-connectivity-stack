/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import { format } from 'util'

import { App, Service } from '../uuids.js'

import { ServiceInterface } from './service-interface.js'

/** Interface to the ConfigDB service. */
export class ConfigDB extends ServiceInterface {
    /** Private. Construct via ServiceClient. */
    constructor (fplus) {
        super(fplus);
        this.service = Service.ConfigDB;
        this.log = this.debug.log.bind(this.debug, "configdb");
    }

    /** Fetch a config entry and its ETag.
     * The ETag is a UUID identifying the current revision of the config
     * entry.
     * @arg app The application UUID.
     * @arg obj The object UUID.
     * @returns A pair `[config, etag]` or `[]` if not found.
     */
    async get_config_with_etag (app, obj) {
        const [st, json, etag] = await this.fetch(`v1/app/${app}/object/${obj}`);
        if (st == 404) return [];
        if (st != 200)
            this.throw(`Can't get ${app} for ${obj}`, st);
        return [json, etag];
    }

    /** Fetch a config entry.
     * @arg app The application UUID.
     * @arg obj The object UUID.
     * @returns The config entry, or `undefined` if not found.
     */
    async get_config (app, obj) {
        const [json] = await this.get_config_with_etag(app, obj);
        return json;
    }

    /** Just fetch the ETag for a config entry.
     * This performs a HEAD request and just returns the ETag.
     * @arg app The application UUID
     * @arg obj The object UUID
     * @returns The ETag, or `undefined`.
     */
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

    /** Update a config entry.
     * @arg app The application UUID
     * @arg obj The object UUID
     * @arg json The config entry, as a JS value
     */
    async put_config (app, obj, json) {
        const [st] = await this.fetch({
            method:     "PUT",
            url:        `/v1/app/${app}/object/${obj}`,
            body:       json,
        });
        if (st == 204 || st == 201) return;
        this.throw(`Can't set ${app} for ${obj}`, st);
    }

    /** Delete a config entry.
     * @arg app The application UUID
     * @arg obj The object UUID
     */
    async delete_config (app, obj) {
        const [st] = await this.fetch({
            method:     "DELETE",
            url:        `/v1/app/${app}/object/${obj}`,
        });
        if (st == 204) return;
        this.throw(`Can't remove ${app} for ${obj}`, st);
    }

    /** Send a PATCH request to update a config entry.
     * Currently the only supported type of patch is `merge`, which
     * sends a JSON merge patch.
     * @arg app The application UUID
     * @arg obj The object UUID
     * @arg type A string identifying the type of patch
     * @arg patch The patch, as a JS object.
     */
    async patch_config (app, obj, type, patch) {
        if (type != "merge")
            throw new RangeEror(`Only merge-patch supported`);

        const [st] = await this.fetch({
            method:         "PATCH",
            url:            `/v1/app/${app}/object/${obj}`,
            body:           patch,
            content_type:   "application/merge-patch+json",
        });
        if (st == 204) return;
        this.throw(`Can't patch ${app} for ${obj}`, st);
    }

    /** List the entries for an application.
     * @arg app The application UUID
     * @returns An array of object UUIDs
     */
    async list_configs (app) {
        const [st, json] = await this.fetch(`v1/app/${app}/object`);
        if (st == 404) return;
        if (st != 200)
            this.throw(`Can't list objects for ${app}`, st);
        return json;
    }

    /** Get all configs for an application.
     * @arg app The application UUID
     * @returns A Map from UUID to config entry
     */
    async get_all_configs (app) {
        const objs = await this.list_configs(app);
        return Promise.all(objs.map(o => 
                this.get_config(app, o)
                    .then(c => [o, c])))
            .then(es => new Map(es));
    }

    /** Create a new object.
     *
     * The class named here will be set as the primary class of the new
     * object. This can be changed later if necessary by patching the
     * _Object registration_ config entry.
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
        if (st != 201 && excl)
            this.throw(`Exclusive create of ${obj} failed`, st);
        if (st == 201 || st == 200)
            return json.uuid;
        if (obj)
            this.throw(`Creating ${obj} failed`, st);
        else
            this.throw(`Creating new ${klass} failed`, st);
    }

    /** Delete an object.
     * This should not normally be called by automated processes. UUIDs
     * should be registered permanently to avoid future conflicts. Use
     * `mark_object_deleted` instead.
     * @arg obj The object UUID
     */
    async delete_object (obj) {
        const [st] = await this.fetch({
            method:     "DELETE",
            url:        `/v1/object/${obj}`,
        });
        if (st == 204) return;
        this.throw(`Deleting ${obj} failed`, st);
    }

    /** Mark an object deleted.
     * This is currently the recommended way to 'delete' an object. This
     * will NOT delete any config entries, the caller will have to
     * handle that. This requires permission to PATCH _Registration_.
     * @arg obj The object UUID
     */
    mark_object_deleted (obj) {
        return this.patch_config(App.Registration, obj, "merge",
            { deleted: true });
    }

    async _class_list (rel, klass) {
        const url = `v2/class/${klass}/${rel}`;
        const [st, list] = await this.fetch(url);
        if (st == 200) return list;
        this.throw(`Can't list '${rel}' for ${klass}`, st);
    }
    /** List the members of a class.
     * This lists all members recursively.
     * @arg klass The class UUID
     * @returns An Array of object UUIDs.
     */
    class_members (klass) { return this._class_list("member", klass); }
    /** List the subclasses of a class.
     * This lists all subclasses recursively.
     * @arg klass The class UUID
     * @returns An Array of object UUIDs.
     */
    class_subclasses (klass) { return this._class_list("subclass", klass); }
    /** List the direct members of a class.
     * This needs permission to edit the class members.
     * @arg klass The class UUID
     * @returns An Array of object UUIDs.
     */
    class_direct_members (klass) { return this._class_list("direct/member", klass); }
    /** List the direct subclasses of a class.
     * This needs permission to edit the class members.
     * @arg klass The class UUID
     * @returns An Array of object UUIDs.
     */
    class_direct_subclasses (klass) { return this._class_list("direct/subclass", klass); }

    async _class_has (rel, klass, obj) {
        const url = `v2/class/${klass}/${rel}/${obj}`;
        const [st] = await this.fetch(url);
        if (st == 204) return true;
        if (st == 404) return false;
        this.throw(`Can't check '${rel}' for ${klass}`, st);
    }
    /* Check if an object is member of a class.
     * @arg klass The class UUID
     * @arg obj The object UUID
     * @returns True or false
     */
    class_has_member (klass, obj) { return this._class_has("member", klass, obj); }
    /* Check if an class is subclass of a class.
     * @arg klass The class UUID
     * @arg obj The possible subclass UUID
     * @returns True or false
     */
    class_has_subclass (klass, obj) { return this._class_has("subclass", klass, obj); }
    /* Check if an object is a direct member of a class.
     * @arg klass The class UUID
     * @arg obj The object UUID
     * @returns True or false
     */
    class_has_direct_member (klass, obj) { 
        return this._class_has("direct/member", klass, obj);
    }
    /* Check if an class is a direct subclass of a class.
     * @arg klass The class UUID
     * @arg obj The possible subclass UUID
     * @returns True or false
     */
    class_has_direct_subclass (klass, obj) {
        return this._class_has("direct/subclass", klass, obj);
    }

    async _class_op (method, rel, klass, obj) {
        const url = `v2/class/${klass}/direct/${rel}/${obj}`;
        const [st] = await this.fetch({ method, url });
        if (st == 204) return;
        const action = method == "PUT" ? ["Adding", "to"] : ["Removing", "from"];
        this.throw(`${action[0]} ${rel} ${obj} ${action[1]} ${klass} failed`, st);
    }
    /** Add a member to a class.
     * Both class and member must already exist as objects.
     * @arg klass The class UUID
     * @arg obj The new class member UUID
     */
    class_add_member (klass, obj) {
        return this._class_op("PUT", "member", klass, obj);
    }
    /** Remove a member from a class.
     * @arg klass The class UUID
     * @arg obj The new class member UUID
     */
    class_remove_member (klass, obj) {
        return this._class_op("DELETE", "member", klass, obj);
    }
    /** Add a subclass to a class.
     * Both class and subclass must already exist as objects.
     * @arg klass The class UUID
     * @arg obj The new subclass UUID
     */
    class_add_subclass (klass, obj) {
        return this._class_op("PUT", "subclass", klass, obj);
    }
    /** Remove a subclass from a class.
     * @arg klass The class UUID
     * @arg obj The subclass UUID
     */
    class_remove_subclass (klass, obj) {
        return this._class_op("DELETE", "subclass", klass, obj);
    }

    /** Search for config entries.
     * Search for config entries matching a query pattern. Optionally
     * restrict the search to objects in a particular class. Optionally
     * extract and return certain properties of the entries found.
     *
     * The query is an object. Keys of this object are JSONPath
     * expressions. Each expression must match the provided value for an
     * entry to match the query. Values to be matched must be scalars.
     *
     * The optional results object extracts properties from the entries.
     * Keys of the object will become the keys in the returned objects;
     * the values are JSONPath expressions to extract a value from the
     * config entry. Each returned object will also have a `uuid` key
     * giving the UUID of the object the entry is for.
     *
     * If `results` is given this returns an array of objects holding
     * the extracted values. Otherwise it returns an array of UUIDS of
     * matching objects.
     *
     * The arguments are either `(app, query, results)` or an object
     * containing these properties.
     * @arg app The application UUID
     * @arg klass (optional) Restrict to objects in this class
     * @arg query The query object
     * @arg results (optional) The results object
     * @returns An array of UUIDs or result objects
     */
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

    /** Use `search` to locate a single object.
     * This calls `search` with the provided options. The `results` key
     * must be omitted. If we get more than one result this throws an
     * exception.
     * @returns The UUID of the single object which matches the query.
     */
    async resolve (opts) {
        if ("results" in opts)
            throw new RangeError("resolve doesn't return results");

        const uuids = await this.search(opts);

        if (!Array.isArray(uuids))
            this.throw("search didn't return an array");
        if (uuids.length > 1)
            this.throw(format("More than one result resolving %s with %o",
                opts.app, opts.query));

        return uuids[0];
    }

    /** Create a ConfigDBWatcher object.
     * This returns a Promise to a ConfigDBWatcher object for this
     * ConfigDB. This allows watching config entry changes over
     * Sparkplug. The notify interface accessed via
     * `@amrc-factoryplus/rx-client` should be preferred for new code.
     *
     * Calling this method will dynamically load
     * `@amrc-factoryplus/sparkplug-app`.
     *
     * @deprecated
     */
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
