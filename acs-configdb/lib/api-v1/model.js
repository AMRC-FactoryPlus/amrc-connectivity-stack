/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * API v1 model
 * Copyright 2021 AMRC
 */

import EventEmitter from "node:events";

import Ajv from "ajv/dist/2020.js";
import ajv_formats from "ajv-formats";
import merge_patch from "json-merge-patch";

import {Debug, DB} from "@amrc-factoryplus/utilities";

import {App, Class, Null_UUID, Service} from "../constants.js";
import { Specials } from "./special.js";

const DB_Version = 7;

const Immutable = new Set([
    Class.Class,
    Class.App,
    App.Registration,
    /* These are required only for the compat endpoints */
    Class.Device,
    Class.Schema,
]);

/* XXX These should be methods on a query object or something... */
async function _q_row(query, sql, params) {
    const dbr = await query(sql, params);
    return dbr.rows[0];
}

async function _q_set(query, sql, params) {
    const dbr = await query(sql, params);
    return dbr.rows;
}

const debug = new Debug();

export default class Model extends EventEmitter {
    constructor(opts) {
        super();
        this.db = new DB({
            version: DB_Version,
            verbose: opts.verbose,
        });


        this.ajv = new Ajv({
            /* We need to use our own schema cache, so we can update it
             * correctly when schemas are uploaded. */
            addUsedSchema: false,
        });
        ajv_formats(this.ajv);
        this.schemas = new Map();

        this.special = new Map();
    }

    async init() {
        await this.db.init();

        for (const Sp of Specials)
            this.special.set(Sp.application, new Sp(this));

        return this;
    }

    emit_change(params) {
        this.emit("change", {
            app: params.app,
            [params.kind]: params.object,
        });
    }

    async _obj_id (query, uuid) {
        const dbr = await query(`
            select o.id
            from object o
            where o.uuid = $1
            for share
        `, [uuid]);
        return dbr.rows[0]?.id;
    }

    async _app_id(query, uuid) {
        /* FOR SHARE because we need this app to persist */
        let dbr = await query(`
            select a.id
            from app a
                join object o on o.id = a.id
            where o.uuid = $1
            for share
        `, [uuid]);
        return dbr.rows[0]?.id;
    }

    async _class_id(query, uuid) {
        let dbr = await query(`
            select c.id
            from class c
                join object o on o.id = c.id
            where o.uuid = $1
            for share
        `, [uuid]);
        return dbr.rows[0]?.id;
    }

    async _object_class(query, uuid) {
        let dbr = await query(`
            select c.uuid
            from object o
                join object c on o.class = c.id
            where o.uuid = $1
        `, [uuid]);

        return dbr.rows[0]?.uuid;
    }

    async object_class(uuid) {
        return await this._object_class(
            this.db.query.bind(this.db), uuid);
    }

    async object_set_class(obj, klass) {
        return await this.db.txn({}, async query => {
            const class_id = await this._class_id(query, klass);
            if (class_id == null) return 404;

            const old_class = await this._object_class(query, obj);
            for (const k of [klass, old_class]) {
                switch (k) {
                    case Class.Class:
                    case Class.App:
                        return 400;
                }
            }

            let dbr = await query(`
                update object
                set class = $1
                where uuid = $2 returning 1 ok
            `, [class_id, obj]);

            return dbr.rows[0]?.ok ? 204 : 404;
        });
    }

    async object_list() {
        let dbr = await this.db.query(`select o.uuid from object o`);
        return dbr.rows.map(r => r.uuid);
    }

    async _maybe_special_class(query, uuid, klass) {
        switch (klass) {
            case Class.Class:
                await query(`
                    insert into class (id)
                    select id from object where uuid = $1
                `, [uuid]);
                break;
            case Class.App:
                await query(`
                    insert into app (id)
                    select id from object where uuid = $1
                `, [uuid]);
                break;
        }
    }

    async object_create(uuid, klass) {
        return await this.db.txn({}, async query => {
            const class_id = await this._class_id(query, klass);
            if (class_id == null) return 404;

            let dbr = await query(`
                insert into object (uuid, class)
                values ($1, $2) on conflict (uuid) do nothing
                returning 1 ok
            `, [uuid, class_id]);

            if (dbr.rowCount == 0) {
                const existing = await this._object_class(query, uuid);
                return existing == klass ? 200 : 409;
            }
            await this._maybe_special_class(query, uuid, klass);
            return 201;
        });
    }

    async object_create_new(klass) {
        return await this.db.txn({}, async query => {
            const class_id = await this._class_id(query, klass);
            if (class_id == null) return [404, null];

            while (1) {
                let dbr = await query(`
                    insert into object (uuid, class)
                    values (gen_random_uuid(), $1) on conflict (uuid) do nothing
                    returning uuid
                `, [class_id]);

                if (dbr.rowCount != 0) {
                    const uuid = dbr.rows[0].uuid;
                    await this._maybe_special_class(query, uuid, klass);
                    return [201, uuid];
                }
            }
        });
    }

    /* Delete an object. Deletes configs associated with this object,
     * but won't delete objects belonging to a class or configs
     * belonging to an app. Returns:
     *  true            Success
     *  undefined       Object not found
     *  false           Object cannot ever be deleted
     *  array           UUIDs of objects preventing deletion
     */
    object_delete(object) {
        return this.db.txn({}, async query => {
            if (Immutable.has(object)) return false;

            const row = await _q_row(query, `
                select o.id, c.uuid klass
                from object o
                    join object c on c.id = o.class
                where o.uuid = $1
            `, [object]);
            if (row == undefined) return undefined;

            const {id, klass} = row;

            /* Don't allow deleting a class which still has objects. */
            if (klass == Class.Class) {
                const objs = await _q_set(query, `
                    select uuid from object where class = $1
                `, [id]);
                if (objs.length > 0)
                    return objs.map(r => r.uuid);
                await query(`delete from class where id = $1`, [id]);
            }

            /* Don't allow deleting an app which still has configs. */
            if (klass == Class.App) {
                const objs = await _q_set(query, `
                    select o.uuid
                    from config c
                        join object o on o.id = c.object
                    where c.app = $1
                `, [id]);
                if (objs.length > 0)
                    return objs.map(r => r.uuid);
                await query(`delete from app where id = $1`, [id]);
            }

            /* Delete configs belonging to this object. */
            await query(`delete from config where object = $1`, [id]);
            /* Delete the object. */
            await query(`delete from object where id = $1`, [id]);
            return true;
        });
    }

    async class_list() {
        const dbr = await this.db.query(`
            select o.uuid
            from class c
                join object o on o.id = c.id
        `);
        return dbr.rows.map(r => r.uuid);
    }

    class_get(klass) {
        return this.db.txn({}, async query => {
            const class_id = await this._class_id(query, klass);
            if (class_id == null) return;

            const dbr = await query(`
                select o.uuid
                from object o
                where o.class = $1
            `, [class_id]);
            return dbr.rows.map(r => r.uuid);
        });
    }

    async config_list(app) {
        const special = this.special.get(app);
        if (special) return await special.list();

        return await this.db.txn({}, async query => {
            let app_id = await this._app_id(query, app);
            if (app_id == null) return null;

            let dbr = await query(`
                select o.uuid
                from config c
                    join object o on o.id = c.object
                where c.app = $1
            `, [app_id]);
            return dbr.rows.map(r => r.uuid);
        });
    }

    async config_class_list(app, klass) {
        return await this.db.txn({}, async query => {
            let app_id = await this._app_id(query, app);
            if (app_id == null) return null;

            let dbr = await query(`
                select o.uuid
                from config c
                    join object o on o.id = c.object
                    join object k on o.class = k.id
                where c.app = $1
                    and k.uuid = $2
            `, [app_id, klass]);
            return dbr.rows.map(r => r.uuid);
        });
    }

    async config_get(q) {
        const special = this.special.get(q.app)
        if (special)
            return await special.get(q.object);

        let dbr = await this.db.query(`
            select c.json, c.etag
            from config c
                join object a on a.id = c.app
                join object o on o.id = c.object
            where a.uuid = $1
                and o.uuid = $2
        `, [q.app, q.object]);

        return dbr.rows[0];
    }

    async config_put(q, json, check_etag) {
        /* XXX specials currently don't support etags */
        const special = this.special.get(q.app);
        if (special) return await special.put(q.object, json);

        const rv = await this.db.txn({}, async query => {
            const appid = await this._app_id(query, q.app);
            if (appid == null) return 404;
            const objid = await this._obj_id(query, q.object);
            if (objid == null) return 404;

            const conf = await _q_row(query, `
                select id, etag 
                from config
                where app = $1 and object = $2
            `, [appid, objid]);

            if (check_etag) {
                const etst = check_etag(conf?.etag);
                if (etst) return etst;
            }

            const schema = await this.find_schema(query, appid);
            if (schema && !schema(json)) return 422;

            json = JSON.stringify(json);

            if (conf) {
                if (q.exclusive) return 409;

                const ok = await query(`
                    update config as c
                    set json = $2, etag = default
                    where id = $1 and json != $2
                    returning 1 ok
                `, [conf.id, json]);

                return ok.rowCount == 0 ? 304 : 204;
            }

            await query(`
                insert into config (app, object, json)
                values ($1, $2, $3)
            `, [appid, objid, json]);

            return 201;
        });

        if (rv == 204 || rv == 201)
            this.emit_change(q);
        /* PUT doesn't return 304 */
        return rv == 304 ? 204 : rv;
    }

    async config_delete(q, check_etag) {
        const special = this.special.get(q.app);
        if (special) return await special.delete(q.object);

        const rv = await this.db.txn({}, async query => {
            const conf = await _q_row(query, `
                select c.id, c.etag
                from config c
                    join object a on a.id = c.app
                    join app on app.id = a.id
                    join object o on o.id = c.object
                where a.uuid = $1 and o.uuid = $2
            `, [q.app, q.object]);

            if (check_etag) {
                const etst = check_etag(conf?.etag);
                if (etst) return etst;
            }
            if (!conf) return 404;

            await query(`
                delete from config
                where id = $1
            `, [conf.id]);
            return 204;
        });

        if (rv == 204) this.emit_change(q);
        return rv;
    }

    /* XXX This does not perform the patch atomically. Properly we
     * should do this all under one transaction, but that would require
     * a substantial rework of the code. */
    async config_merge_patch (q, patch, check_etag) {
        const conf = await this.config_get(q);

        if (check_etag) {
            const etst = check_etag(conf?.etag);
            if (etst) return etst;
        }

        /* This needs to be null, not undefined, for a nonexistent
         * object, or the 409 test below will fail. */
        const json = conf?.json ?? null;
        console.log("PATCH: source: %o", json);
        console.log("PATCH: patch: %o", patch);

        /* Safety check: applying a merge-patch to a non-object destroys
         * the whole thing. */
        if (typeof(json) != "object" || Array.isArray(json))
            return 409;

        const nconf = merge_patch.apply(json, patch);
        console.log("PATCH: result: %o", nconf);
        return await this.config_put(q, nconf);
    }

    async config_search(app, klass, query) {
        return await this.db.txn({}, async q => {
            const a_id = await this._app_id(q, app);
            const c_id = klass == null ? null : await this._class_id(q, klass);

            if (a_id === undefined || c_id === undefined)
                return [];

            const select = Object.fromEntries(query.select);
            const where = Array.from(query.where)
                .map(([path, val]) => 
                    val == "undefined" ? `!exists($.${path})`
                    : `$.${path} == ${val}`);

            return await this._do_config_search(q, [a_id, c_id, where, select]);
        });
    }

    async _do_config_search(query, bind) {
        const dbr = await query(`
            with results as (
                select c.id,
                    coalesce(every(c.json @@ w.test), true) matches,
                    jsonb_object_agg(
                        coalesce(p.prop, ''),
                        c.json #> string_to_array(p.path, '.')
                    ) results
                from config c
                    left join unnest($3::jsonpath[]) w(test) on true
                    left join jsonb_each_text($4) p(prop, path) on true
                group by c.id)
            select o.uuid, jsonb_strip_nulls(r.results) results
            from config c
                join results r on r.id = c.id
                join object o on o.id = c.object
            where r.matches
                and c.app = $1
                and (o.class = $2 or $2 is null);
        `, bind);

        return dbr.rows;
    }

    async apps_get() {
        let dbr = await this.db.query(`
            select o.uuid
            from app a
                join object o on o.id = a.id
        `);

        return dbr.rows.map(r => r.uuid);
    }

    async find_schema(query, app) {
        if (this.schemas.has(app))
            return this.schemas.get(app);

        let dbr = await query(`
            select a.schema
            from app a
            where a.id = $1
        `, [app]);

        const schema_text = dbr.rows[0]?.schema;
        if (schema_text == null)
            return null;

        const schema = this.ajv.compile(schema_text);
        this.schemas.set(app, schema);
        return schema;
    }

    async app_schema_list () {
        const dbr = await this.db.query(`
            select o.uuid
            from app a
                join object o on o.id = a.id
            where a.schema is not null
        `);
        return dbr.rows.map(r => r.uuid);
    }

    app_schema(app) {
        return this.db.txn({}, async query => {
            const appid = await this._app_id(query, app);
            if (appid == null) return null;
            return this.find_schema(query, appid);
        });
    }

    async app_schema_update(app, schema) {
        /* blecch v = try {} pretty please */
        let validate;
        try {
            validate = this.ajv.compile(schema);
        } catch (e) {
            return null;
        }

        return await this.db.txn({}, async query => {
            const app_id = await this._app_id(query, app);
            if (app_id == null) return false;

            // FOR SHARE so we lock the rows
            let dbr = await query(`
                select o.uuid object, c.json
                from config c
                    join object o on o.id = c.object
                where c.app = $1
                for share
            `, [app_id]);

            const bad = dbr.rows
                .filter(r => !validate(r.json))
                .map(r => r.object);
            if (bad.length > 0) return bad;

            dbr = await query(`
                update app set schema = $2 where id = $1
            `, [app_id, schema]);

            this.schemas.set(app_id, validate);
            this.emit("change", {app});
            return true;
        });
    }

    async dump_validate(dump) {
        if (typeof (dump) != "object") {
            debug.log("dump", "Dump not an object");
            return false;
        }
        if (dump.service != Service.Registry) {
            debug.log("dump", "Dump not for ConfigDB");
            return false;
        }
        if (dump.version != 1) {
            debug.log("dump", "Dump should be version 1");
            return false;
        }
        if (Class.Class in (dump.objects ?? {})) {
            debug.log("dump", "Dump cannot create classes via objects key.");
            return false;
        }
        if (App.Registration in (dump.configs ?? {})) {
            debug.log("dump", "Dump cannot create objects via configs key.");
            return false;
        }
        return true;
    }

    async dump_load(dump, overwrite) {
        /* XXX This loads the dump in multiple transactions, which is
         * not ideal. But loading in one transaction, with the
         * additional logic involved, means reworking all the
         * transaction handling. Maybe later... */

        if (!this.dump_validate(dump))
            return 400;

        /* The order of loading here is important. This is why Classes
         * are handled separately from the others. */
        for (const klass of dump.classes ?? []) {
            const st = await this.object_create(klass, Class.Class);
            if (st > 299) {
                debug.log("dump", "Dump failed [%s] on class %s", st, klass);
                return st;
            }
        }
        for (const [klass, objs] of Object.entries(dump.objects ?? {})) {
            for (const obj of objs) {
                let st = await this.object_create(obj, klass);
                if (st == 409 && overwrite) {
                    st = await this.object_set_class(obj, klass);
                }
                if (st > 299) {
                    debug.log("dump", "Dump failed [%s] on object %s (%s)",
                        st, obj, klass);
                    return st;
                }
            }
        }
        for (const [app, objs] of Object.entries(dump.configs ?? {})) {
            for (const [object, conf] of Object.entries(objs)) {
                const st = await this.config_put(
                    {app, object, exclusive: !overwrite},
                    conf);
                if (st > 299 && st != 409) {
                    debug.log("dump", "Dump failed [%s] on config %s/%s", 
                        st, app, object);
                    return st;
                }
            }
        }

        return 204;
    }

    async dump_save() {
        /* Txn as above... */
        const classes = await this.class_list();

        const objects = await Promise.all(
            classes.filter(c => c != Class.Class)
                .map(c =>
                    this.class_get(c)
                        .then(objs => [c, objs])))
            .then(l => Object.fromEntries(
                l.filter(e => e[1].length > 0)));

        const configs = await this.apps_get()
            .then(apps => Promise.all(
                apps.filter(a => a != App.Registration)
                    .map(a => this.config_list(a)
                        .then(objs => Promise.all(
                            objs.map(o => this.config_get({app: a, object: o})
                                .then(c => [o, c])))
                            .then(l => [a, Object.fromEntries(l)])))))
            .then(l => Object.fromEntries(l));

        return {
            service: Service.Registry,
            version: 1,
            classes,
            objects,
            configs,
        };
    }
}
