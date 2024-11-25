/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * API v1 model
 * Copyright 2021 AMRC
 */

import EventEmitter from "node:events";

import Ajv from "ajv/dist/2020.js";
import ajv_formats from "ajv-formats";
import merge_patch from "json-merge-patch";
import rx from "rxjs";

import { DB } from "@amrc-factoryplus/utilities";

import {App, Class, Service, SpecialObj} from "./constants.js";
import { SpecialApps } from "./special.js";

const DB_Version = 9;

/* Well-known object IDs. This is cheating but it's stupid to keep
 * looking them up. */
const ObjID = {
    Object:         0,
    Class:          1,
    App:            2,
    Registration:   6,
    Info:           7,
    ConfigDB:       9,
    Rank:           10,
    Individual:     11,
    R1Class:        12,
    Special:        13,
    Wildcard:       14,
    Unowned:        15,
    ConfigSchema:   16,
};

const Immutable = new Set([
    Class.Class,
    Class.App,
    Class.SpecialObj,
    App.Registration,
    App.ConfigSchema,
    SpecialObj.Wildcard,
    SpecialObj.Unowned,
    /* These are required only for the compat endpoints */
    Class.Device,
    Class.Schema,
]);

/* XXX These should be methods on a query object or something... */
function _q_set(query, sql, params) {
    return query(sql, params).then(dbr => dbr.rows);
}

function _q_row (...args) {
    return _q_set(...args).then(rs => rs[0]);
}

function _q_uuids (...args) {
    return _q_set(...args).then(rs => rs.map(r => r.uuid));
}

export default class Model extends EventEmitter {
    constructor(opts) {
        super();
        this.log = opts.log;

        this.db = new DB({
            version: DB_Version,
        });

        this.ajv = new Ajv({
            /* We need to use our own schema cache, so we can update it
             * correctly when schemas are uploaded. */
            addUsedSchema: false,
        });
        ajv_formats(this.ajv);
        this.schemas = new Map();

        this.special = new Map();

        /* { app, obj, etag, config }
         * config is undefined for a delete entry */
        this.updates = new rx.Subject();
    }

    async init() {
        await this.db.init();

        for (const Sp of SpecialApps)
            this.special.set(Sp.application, new Sp(this));

        return this;
    }

    emit_change(params) {
        this.emit("change", {
            app: params.app,
            [params.kind]: params.object,
        });
    }

    /* XXX For now I am not verifying the e.g. App-UUIDs actually refer
     * to objects in the Application class. These class membership tests
     * seem to be unavoidably slow which is not surprising. Possibly
     * this can be resolved with caching of some kind. */

    async _obj_id (query, uuid) {
        const dbr = await query(`
            select o.id
            from object o
            where o.uuid = $1
        `, [uuid]);
        return dbr.rows[0]?.id;
    }

    _app_id (query, app) { return this._obj_id(query, app); }
    _class_id (query, klass) { return this._obj_id(query, klass); }

    object_info (obj) {
        return _q_row(this.db.query.bind(this.db), `
            select o.deleted, p.uuid owner
            from object o
                join object p on p.id = o.owner
            where o.uuid = $1
        `, [obj]);
    }

    object_list() {
        return _q_uuids(this.db.query.bind(this.db),
            `select o.uuid from object o`);
    }

    /* XXX This is the correct place to set the owner of the new object
     * but I don't have access to that information yet. */
    async _object_create (query, uuid) {
        const created = await query(`
            insert into object (uuid) values ($1)
            on conflict (uuid) do update
                set deleted = false
                where object.deleted
            returning id, owner
        `, [uuid]);

        if (created.rowCount)
            return { ...created.rows[0], uuid, created: true }

        const obj = await query(`
            select id, owner from object
            where uuid = $1
        `, [uuid]);

        return { ...obj.rows[0], uuid, created: false };
    }

    async _object_create_new (query) {
        /* Normally this loop will return first time round. On the
         * (astronomically) rare occasion that Pg generates a UUID which
         * conflicts with one already in the database we will retry. */
        for (;;) {
            const obj = await query(`
                insert into object default values
                on conflict (uuid) do nothing
                returning id, uuid, owner
            `);
            if (obj.rowCount)
                return { ...obj.rows[0], created: true };
        }
    }

    _add_member (query, klass, object) {
        return query(`
            insert into membership (class, id)
            values ($1, $2)
            on conflict (class, id) do nothing
        `, [klass, object]);
    }

    _set_primary_class (query, objid, klass) {
        return query(`
            insert into config (app, object, json)
            values ($1, $2, $3)
            on conflict (app, object) do update
                set json = config.json || excluded.json,
                    etag = default
        `, [ObjID.Info, objid, { primaryClass: klass }]);
    }

    /* User-created objects must be members of a class */
    async object_create(uuid, klass) {
        const obj = await this.db.txn({}, async query => {
            const class_id = await this._class_id(query, klass);
            if (class_id == null) return 404;

            const obj = await (uuid
                ? this._object_create(query, uuid)
                : this._object_create_new(query))

            /* XXX This matches approximately the existing API where
             * creating an existing object only fails if the class
             * doesn't match. We can add objects to multiple classes now
             * so we never fail for that reason; this call will update
             * the primaryClass but leave any existing class memberships
             * alone. However when we handle ownership correctly we
             * might need to fail because the owner is incorrect. */

            await this._add_member(query, class_id, obj.id);
            await this._set_primary_class(query, obj.id, klass);
            return obj;
        });
        this.updates.next({
            app:    App.Registration,
            object: uuid,
            config: { deleted: false },
        });
        return obj;
    }

    /* Delete an object. Deletes configs associated with this object,
     * but won't delete objects belonging to a class or configs
     * belonging to an app. Returns [st, body?].
     */
    async object_delete(object) {
        const [st, body] = await this.db.txn({}, async query => {
            if (Immutable.has(object)) return [405];

            const id = this._obj_id(query, object);
            if (id == null) return [404];

            const members = await _q_uuids(query, `
                select o.uuid 
                from membership m join object o on o.id = m.id
                where m.class = $1
            `, [id]);
            if (members.length)
                return [409, members];

            const subclasses = await _q_uuids(query, `
                select o.uuid
                from subclass s join object o on o.id = s.id
                where s.class = $1
            `, [id]);
            if (subclasses.length)
                return [409, subclasses];

            const usage = await _q_uuids(query, `
                select o.uuid
                from config c join object o on o.id = c.object
                where c.app = $1
            `, [id]);
            if (usage.length)
                return [409, usage];

            /* Delete configs belonging to this object. */
            const confs = await _q_uuids(query, `
                delete from config c using object a
                where a.id = c.app and c.object = $1
                returning a.uuid
            `, [id]);
            /* Delete the object. */
            await query(`delete from object where id = $1`, [id]);
            return [204, confs];
        });

        if (st != 204)
            return [st, body];

        for (const app of body)
            this.updates.next({ app, object });
        this.updates.next({ app: App.Registration, object });
        return [st];
    }

    class_list () {
        return _q_uuids(this.db.query.bind(this.db), `
            select o.uuid
            from all_class k join object o on o.id = k.id
        `)
    }

    class_list_proper () {
        return _q_uuids(this.db.query.bind(this.db), `
            select o.uuid from object o
            where o.id not in (select id from membership)
        `);
    }

    _class_lookup (query, id, table) {
        return _q_uuids(query, `
            select o.uuid
            from ${table} k join object o on o.id = k.id
            where k.class = $1
        `, [id]);
    }

    class_lookup (klass, table) {
        return this.db.txn({}, async query => {
            const id = await this._class_id(query, klass);
            if (id == null) return;
            return this._class_lookup(query, id, table);
        });
    }

    _config_list (app) {
        return this.db.txn({}, async query => {
            const app_id = await this._app_id(query, app);
            if (app_id == null) return null;

            return _q_uuids(query, `
                select o.uuid
                from config c
                    join object o on o.id = c.object
                where c.app = $1
            `, [app_id]);
        });
    }

    async config_list(app) {
        const special = this.special.get(app);
        if (special) return special.list();
        return this._config_list(app);
    }

    async config_class_list(app, klass) {
        return await this.db.txn({}, async query => {
            const app_id = await this._app_id(query, app);
            if (app_id == null) return null;
            const class_id = await this._class_id(query, klass);
            if (class_id == null) return null;

            return _q_uuids(query, `
                select o.uuid
                from config c
                    join object o on o.id = c.object
                    join all_membership m on m.id = c.object
                where c.app = $1
                    and m.class = $2
            `, [app_id, klass]);
        });
    }

    _config_get (app, object) {
        return _q_row(this.db.query.bind(this.db), `
            select c.json config, c.etag
            from config c
                join object a on a.id = c.app
                join object o on o.id = c.object
            where a.uuid = $1
                and o.uuid = $2
        `, [app, object]);
    }

    config_get(q) {
        const special = this.special.get(q.app)
        if (special)
            return special.get(q.object);
        return this._config_get(q.app, q.object);
    }

    async config_put(q, config, check_etag) {
        /* XXX specials currently don't support etags */
        /* XXX specials should push to updates */
        const special = this.special.get(q.app);
        if (special) return await special.put(q.object, config);

        const rv = await this.db.txn({}, async query => {
            const appid = await this._app_id(query, q.app);
            if (appid == null) return 404;
            const objid = await this._obj_id(query, q.object);
            if (objid == null) return 404;

            const old = await _q_row(query, `
                select id, etag 
                from config
                where app = $1 and object = $2
            `, [appid, objid]);

            if (check_etag) {
                const etst = check_etag(old?.etag);
                if (etst) return etst;
            }

            const schema = await this.find_schema(query, appid);
            if (schema && !schema(config)) return 422;

            const json = JSON.stringify(config);

            if (old) {
                if (q.exclusive) return 409;

                const ok = await query(`
                    update config as c
                    set json = $2, etag = default
                    where id = $1 and json != $2
                    returning 1 ok
                `, [old.id, json]);

                return ok.rowCount == 0 ? 304 : 204;
            }

            await query(`
                insert into config (app, object, json)
                values ($1, $2, $3)
            `, [appid, objid, json]);

            return 201;
        });

        if (rv == 204 || rv == 201) {
            this.emit_change(q);
            this.updates.next({ ...q, config });
        }
        /* PUT doesn't return 304 */
        return rv == 304 ? 204 : rv;
    }

    async config_delete(q, check_etag) {
        /* XXX specials should push to updates */
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

        if (rv == 204) {
            this.emit_change(q);
            this.updates.next(q);
        }
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

        /* Safety check: applying a merge-patch to a non-object destroys
         * the whole thing. */
        if (typeof(json) != "object" || Array.isArray(json))
            return 409;

        const nconf = merge_patch.apply(json, patch);
        return await this.config_put(q, nconf);
    }

    async config_search(app, klass, query) {
        const select = Object.fromEntries(query.select);
        const where = Array.from(query.where)
            .map(([path, val]) => 
                val == "undefined" ? `!exists($.${path})`
                : `$.${path} == ${val}`);

        return await this.db.txn({}, async q => {
            const a_id = await this._app_id(q, app);
            const c_id = klass == null ? null : await this._class_id(q, klass);

            if (a_id === undefined || c_id === undefined)
                return [];

            return await this._do_config_search(q, c_id, a_id, where, select);
        });
    }

    async _do_config_search(query, klass, app, where, select) {
        const k_join = klass ? `join all_membership m on m.id = c.id` : "";
        const k_whre = klass ? `and m.class = $4` : "";
        const bind = [app, where, select];
        if (klass) bind.push(klass);

        return _q_set(query, `
            with results as (
                select c.id,
                    coalesce(every(c.json @@ w.test), true) matches,
                    jsonb_object_agg(
                        coalesce(p.prop, ''),
                        c.json #> string_to_array(p.path, '.')
                    ) results
                from config c
                    left join unnest($2::jsonpath[]) w(test) on true
                    left join jsonb_each_text($3) p(prop, path) on true
                group by c.id)
            select o.uuid, jsonb_strip_nulls(r.results) results
            from config c
                join results r on r.id = c.id
                join object o on o.id = c.object
                ${k_join}
            where r.matches
                and c.app = $1
                ${k_whre}
        `, bind);
    }

    async find_schema(query, app) {
        if (this.schemas.has(app))
            return this.schemas.get(app);

        const schema_text = await _q_row(query, `
            select json from config
            where app = ${ObjID.ConfigSchema} and object = $1
        `, [app]).then(r => r?.json);

        if (schema_text == null)
            return null;

        const schema = this.ajv.compile(schema_text);
        this.schemas.set(app, schema);
        return schema;
    }

    app_schema_list () {
        return this._config_list(App.ConfigSchema);
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

            const configs = await _q_set(query, `
                select o.uuid object, c.json
                from config c
                    join object o on o.id = c.object
                where c.app = $1
            `, [app_id]);

            const bad = configs
                .filter(r => !validate(r.json))
                .map(r => r.object);
            if (bad.length > 0) return bad;

            await query(`
                insert into config (app, object, json)
                values (${ObjID.ConfigSchema}, $1, $2)
                on conflict (app, object) do update
                set json = excluded.json, etag = default
            `, [app_id, schema]);

            this.schemas.set(app_id, validate);
            this.emit("change", {app});
            this.updates.next({
                app:    App.ConfigSchema, 
                object: app,
                config: schema,
            });
            return true;
        });
    }

    async dump_validate(dump) {
        if (typeof (dump) != "object") {
            this.log("Dump not an object");
            return false;
        }
        if (dump.service != Service.Registry) {
            this.log("Dump not for ConfigDB");
            return false;
        }
        if (dump.version != 1) {
            this.log("Dump should be version 1");
            return false;
        }
        if (Class.Class in (dump.objects ?? {})) {
            this.log("Dump cannot create classes via objects key.");
            return false;
        }
        if (App.Registration in (dump.configs ?? {})) {
            this.log("Dump cannot create objects via configs key.");
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
                this.log("Dump failed [%s] on class %s", st, klass);
                return st;
            }
        }
        for (const [klass, objs] of Object.entries(dump.objects ?? {})) {
            for (const obj of objs) {
                let st = await this.object_create(obj, klass);
                if (st > 299) {
                    this.log("Dump failed [%s] on object %s (%s)",
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
                    this.log("Dump failed [%s] on config %s/%s", 
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
