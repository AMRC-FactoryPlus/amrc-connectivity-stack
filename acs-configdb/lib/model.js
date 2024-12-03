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
    R1Class:        1,
    App:            2,
    Registration:   6,
    Info:           7,
    ConfigDB:       9,
    Individual:     10,
    R2Class:        11,
    R3Class:        12,

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

    async _rank_id (query, rank) {
        const dbr = await query(`
            select r.id
            from rank r 
            where r.depth = $1
        `, [rank]);
        return dbr.rows[0]?.id;
    }

    _object_info (query, obj) {
        return _q_row(query, `
            select o.uuid, c.uuid class, o.rank, p.uuid owner, o.deleted
            from object o
                left join object c on c.id = o.class
                join object p on p.id = o.owner
            where o.uuid = $1
        `, [obj]);
    }
    object_info (obj) {
        return this._object_info(this.db.query.bind(this.db), obj);
    }

    object_list() {
        return _q_uuids(this.db.query.bind(this.db),
            `select o.uuid from object o`);
    }

    object_ranks () {
        return _q_uuids(this.db.query.bind(this.db), `
            select o.uuid
            from rank r
                join object o on o.id = r.id
            order by r.depth
        `);
    }

    /* XXX This is the correct place to set the owner of the new object
     * but I don't have access to that information yet. */
    async _object_create (query, uuid, klass) {
        return _q_row(query, `
            insert into object (uuid, class, rank)
            select $1, c.id, c.rank - 1
                from object c
                where c.id = $2
            returning id, uuid
        `, [uuid, klass]);
    }

    async _object_create_new (query, klass) {
        /* Normally this loop will return first time round. On the
         * (astronomically) rare occasion that Pg generates a UUID which
         * conflicts with one already in the database we will retry. */
        for (;;) {
            const obj = await query(`
                insert into object (class, rank)
                select c.id, c.rank - 1
                    from object c
                    where c.id = $1
                on conflict (uuid) do nothing
                returning id, uuid
            `, [klass]);
            if (obj.rowCount)
                return obj.rows[0];
        }
    }

    /* This will do nothing for individuals as depth -1 cannot exist in
     * the rank table. */
    _add_rank_superclass (query, object) {
        return query(`
            insert into subclass (class, id)
            select r.id, o.id
            from object o
                join rank r on r.depth = o.rank - 1
            where o.id = $1
        `, [object]);
    }

    _add_member (query, klass, object) {
        return query(`
            insert into membership (class, id)
            values ($1, $2)
            on conflict (class, id) do nothing
        `, [klass, object]);
    }

    _add_subclass (query, klass, object) {
        return query(`
            insert into subclass (class, id)
            values ($1, $2)
            on conflict (class, id) do nothing
        `, [klass, object]);
    }

    /* XXX This is to create a new rank. This must be the parent of the
     * current topmost rank. */
    _maybe_new_rank (q, spec) {
        return [404];
    }

    async _update_registration (q, id, spec) {
        const info = await this._config_get(ObjID.Registration, id)
            .then(r => r?.config);
        if (!info) {
            this.log("Object ID with no Registration entry: %s", id);
            return 500;
        }

        /* XXX These should be changable, with restrictions. */
        if (spec.class != null && spec.class != info.class) {
            this.log("Class mismatch for create: %s: have %s, want %s",
                info.uuid, info.class, spec.class);
            return 409;
        }
        if (spec.rank != null && spec.rank != info.rank) {
            this.log("Rank mismatch for create: %s: have %s, want %s",
                info.uuid, info.rank, spec.rank);
            return 409;
        }

        await q(`update object set deleted = $2 where id = $1`,
            [id, spec.deleted]);
        await q(`call update_registration($1)`, [id]);

        return 200;
    }

    /* Object creation must supply a class or a rank (not both) */
    async object_create(spec) {
        const [st, uuid] = await this.db.txn({}, async q => {
            if (spec.uuid) {
                const id = await this._obj_id(q, spec.uuid);
                if (id) {
                    const st = await this._update_registration(q, id, 
                        { ...spec, deleted: false });
                    return [st, spec.uuid];
                }
            }

            let c_id;
            if (spec.rank) {
                if (spec.class) return [422];
                const id = await this._rank_id(q, spec.rank);
                if (!id)
                    return this._maybe_new_rank(q, spec);
                c_id = id;
            }
            else {
                if (!spec.class) return [422];
                const id = await this._obj_id(q, spec.class);
                if (!id) return [404];
                c_id = id;
            }

            const obj = await (spec.uuid
                ? this._object_create(q, spec.uuid, c_id)
                : this._object_create_new(q, c_id))

            await this._add_member(q, c_id, obj.id);
            await this._add_rank_superclass(q, obj.id);
            await q(`call update_registration($1)`, [obj.id]);

            return [201, obj.uuid];
        });

        if (st < 299)
            this.updates.next({
                app:    App.Registration,
                object: uuid,
                config: { deleted: false },
            });
        return [st, uuid];
    }

    /* Delete an object. Deletes configs associated with this object,
     * but won't delete objects belonging to a class or configs
     * belonging to an app. Returns [st, body?].
     */
    async object_delete(object) {
        const [st, body] = await this.db.txn({}, async query => {
            if (Immutable.has(object)) return [405];

            const id = await this._obj_id(query, object);
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

    async class_has (klass, table, obj) {
        const dbr = await this.db.query(`
            select 1
            from ${table} r
                join object c on c.id = r.class
                join object o on o.id = r.id
            where c.uuid = $1 and o.uuid = $2
        `, [klass, obj]);
        return !!dbr.rows;
    }

    class_add_member (klass, obj) {
        return this.db.txn({}, async query => {
            const c_id = await this._class_id(query, klass);
            const o_id = await this._obj_id(query, obj);
            if (c_id == null || o_id == null) return;
            return this._add_member(query, c_id, o_id);
        });
    }

    class_add_subclass (klass, subclass) {
        return this.db.txn({}, async query => {
            const c_id = await this._class_id(query, klass);
            const s_id = await this._class_id(query, subclass);
            if (c_id == null || s_id == null) return;
            return this._add_subclass(query, c_id, s_id);
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
        if (special && special.list)
            return special.list();
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
            select c.id, c.json config, c.etag
            from config c
            where c.app = $1 and c.object = $2
        `, [app, object]);
    }

    config_get(q) {
        const special = this.special.get(q.app)
        /* XXX This is not correct. We need to at least cache the result
         * for PATCH. */
        if (special && special.get)
            return special.get(q.object);

        return _q_row(this.db.query.bind(this.db), `
            select c.json config, c.etag
            from config c
                join object a on a.id = c.app
                join object o on o.id = c.object
            where a.uuid = $1
                and o.uuid = $2
        `, [q.app, q.object]);
    }

    async _config_validate (query, app, config) {
        const schema = await this.find_schema(query, app);
        if (schema && !schema(config))
            return { status: 422 };
        return { status: 204 };
    }

    /* The caller must pass (in opts):
     * app, object      object ids (not UUIDs)
     * config           the new config
     * old              the id in the config table of the existing entry
     * special          a SpecialApp, or undefined
     * Etags must be already checked. We will return 304 to indicate a
     * successful no-change update.
     */
    async _config_put (query, opts) {
        const valid = opts.special?.validate
            ? await opts.special.validate(query, opts.object, opts.config)
            : await this._config_validate(query, opts.app, opts.config);
        if (valid.status > 299)
            return valid.status;

        const config = valid.config ?? opts.config;
        /* Don't rely on node-postgres, it will pass through a bare
         * string without stringifying it again. */
        const json = JSON.stringify(config);
            
        if (opts.old) {
            const ok = await query(`
                update config as c
                set json = $2, etag = default
                where id = $1 and json != $2
                returning 1 ok
            `, [opts.old, json]);

            return ok.rowCount ? 204 : 304;
        }

        await query(`
            insert into config (app, object, json)
            values ($1, $2, $3)
        `, [opts.app, opts.object, json]);

        return 201;
    }

    async config_put(q, config, check_etag) {
        const special = this.special.get(q.app);

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
                const st = check_etag(old?.etag);
                if (st) return st;
            }

            return await this._config_put(query, {
                config, special,
                app:        appid,
                object:     objid,
                old:        old?.id,
            });
        });

        if (rv == 204 || rv == 201) {
            this.emit_change(q);
            this.updates.next({ ...q, config });
        }
        /* PUT doesn't return 304 */
        return rv == 304 ? 204 : rv;
    }

    async config_delete(q, check_etag) {
        const special = this.special.get(q.app);

        const rv = await this.db.txn({}, async query => {
            const conf = await _q_row(query, `
                select c.id, c.etag, o.id objid
                from config c
                    join object a on a.id = c.app
                    join object o on o.id = c.object
                where a.uuid = $1 and o.uuid = $2
            `, [q.app, q.object]);

            if (check_etag) {
                const st = check_etag(conf?.etag);
                if (st) return st;
            }
            if (!conf) return 404;

            if (special?.delete) {
                const st = special.delete(conf.objid);
                if (st > 299) return st;
            }

            await query(`delete from config where id = $1`, [conf.id]);
            return 204;
        });

        if (rv == 204) {
            this.emit_change(q);
            this.updates.next(q);
        }
        return rv;
    }

    async config_merge_patch (q, patch, check_etag) {
        const special = this.special.get(q.app);

        const [st, config] = await this.db.txn({}, async query => {
            const app = await this._app_id(query, q.app);
            const object = await this._obj_id(query, q.object);
            if (!app || !object) return [404];

            const old = await this._config_get(app, object);

            if (check_etag) {
                const st = check_etag(old?.etag);
                if (st) return [st];
            }

            /* This needs to be null, not undefined, for a nonexistent
             * object, or the 409 test below will fail. */
            const json = old?.json ?? null;

            /* Safety check: applying a merge-patch to a non-object destroys
             * the whole thing. */
            if (typeof(json) != "object" || Array.isArray(json))
                return [409];

            const config = merge_patch.apply(json, patch);
            const put = await this._config_put(query, {
                app, object, config, special,
                old:    old?.id,
            });
            return [put, config];
        });
        if (st < 300) {
            this.emit_change({ app: q.app, config });
            this.updates.next({ app: q.app, object: q.object, config });
        }
        return st;
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

        const text = await _q_row(query, `
            select json from config
            where app = ${ObjID.ConfigSchema} and object = $1
        `, [app]).then(r => r?.json);

        const schema = text ? this.ajv.compile(text) : null;
        this.schemas.set(app, schema);
        return schema;
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
        for (const uuid of dump.classes ?? []) {
            /* XXX temporary hack while the ACS dumps attempt to create
             * this class */
            if (uuid == Class.Class)
                continue;
            this.log("LOAD CLASS %s", uuid);
            const [st] = await this.object_create({ uuid, rank: 1 });
            if (st > 299) {
                this.log("Dump failed [%s] on class %s", st, uuid);
                return st;
            }
        }
        for (const [klass, objs] of Object.entries(dump.objects ?? {})) {
            for (const uuid of objs) {
                this.log("LOAD OBJECT %s/%s", klass, uuid);
                let [st] = await this.object_create({ uuid, class: klass });
                if (st > 299) {
                    this.log("Dump failed [%s] on object %s (%s)",
                        st, uuid, klass);
                    return st;
                }
            }
        }
        for (const [app, objs] of Object.entries(dump.configs ?? {})) {
            for (const [object, conf] of Object.entries(objs)) {
                this.log("LOAD CONFIG %s/%s", app, object);
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
