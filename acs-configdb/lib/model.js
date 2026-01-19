/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import EventEmitter from 'node:events'

import Ajv from 'ajv/dist/2020.js'
import ajv_formats from 'ajv-formats'
import deep_equal from 'deep-equal'
import merge_patch from 'json-merge-patch'
import rx from 'rxjs'

import { DB } from '@amrc-factoryplus/pg-client'

import { App, Class, Perm, Service, SpecialObj } from './constants.js'
import { SpecialApps } from './special.js'

const DB_Version = 11;

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
        this.log = opts.debug.bound("model");

        this.authz = opts.auth;
        this.db = new DB({
            debug:      opts.debug,
            version:    DB_Version,
        });

        this.ajv = new Ajv({
            /* We need to use our own schema cache, so we can update it
             * correctly when schemas are uploaded. */
            addUsedSchema: false,
        });
        ajv_formats(this.ajv);

        this.schemas = new Map();

        /* { app, obj, etag, config }
         * config is undefined for a delete entry */
        this.updates = new rx.Subject();
    }

    async init() {
        await this.db.init();

        return this;
    }

    with_req (req) {
        const rv = Object.create(this);
        rv.upn = req.auth;
        return rv;
    }

    async fetch_acl () {
        if (!this.upn)
            return () => false;
        return this.authz.fetch_acl(this.upn);
    }

    async check_acl (perm, targ) {
        if (!this.upn)
            return;
        return this.authz.check_acl(this.upn, perm, targ, true);
    }

    async client_uuid () {
        if (!this.upn) return;
        return this._client_uuid ??= await this.authz.resolve_upn(this.upn);
    }

    get_special (app) {
        const Sp = SpecialApps.find(s => s.application == app);
        if (!Sp) return;
        return new Sp(this);
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
    async _obj_info (query, uuid) {
        return _q_row(query, `
            select o.id, o.uuid, o.class, o.rank
            from object o
            where o.uuid = $1
        `, [uuid]);
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
    async _object_create_uuid (query, uuid, klass, owner) {
        return _q_row(query, `
            insert into object (uuid, class, rank, owner)
            select $1, c.id, c.rank - 1, $3
                from object c
                where c.id = $2
            returning id, uuid
        `, [uuid, klass, owner]);
    }

    async _object_create_new (query, klass, owner) {
        /* Normally this loop will return first time round. On the
         * (astronomically) rare occasion that Pg generates a UUID which
         * conflicts with one already in the database we will retry. */
        for (;;) {
            const obj = await query(`
                insert into object (class, rank, owner)
                select c.id, c.rank - 1, $2
                    from object c
                    where c.id = $1
                on conflict (uuid) do nothing
                returning id, uuid
            `, [klass, owner]);
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

    _class_lookup (query, id, table) {
        return _q_uuids(query, `
            select distinct o.uuid
            from ${table} k join object o on o.id = k.id
            where k.class = $1
        `, [id]);
    }

    _class_has (query, klass, table, obj) {
        return query(`
            select 1 from ${table} r
            where r.class = $1 and r.id = $2
        `, [klass, obj])
            .then(r => r.rowCount != 0);
    }

    _class_add (query, klass, table, obj) {
        return query(`
            insert into ${table} (class, id)
            values ($1, $2)
            on conflict (class, id) do nothing
        `, [klass, obj]);
    }

    _class_remove (query, klass, table, obj) {
        return query(`
            delete from ${table}
            where class = $1 and id = $2
        `, [klass, obj]);
    }

    /* XXX This is to create a new rank. This must be the parent of the
     * current topmost rank. */
    _maybe_new_rank (q, spec) {
        return [404];
    }

    async update_registration (q, id, spec) {
        const info = await this._config_get(q, ObjID.Registration, id)
            .then(r => r?.json);
        if (!info) {
            this.log("Object ID with no Registration entry: %s", id);
            return 500;
        }

        /* Calls from object_create won't be complete */
        spec = merge_patch.apply({ ...info }, spec);
        if (deep_equal(info, spec))
            return 204;

        if (spec.uuid != info.uuid)
            return 409;

        if (spec.owner != info.owner) {
            const st = await this._update_owner(q, id, info, spec);
            if (st != 204) return st;
        }

        if (spec.rank != info.rank) {
            const st = await this._update_rank(q, id, info, spec);
            if (st != 204) return st;
        }
        else if (spec.class != info.class) {
            const st = await this._update_class(q, id, spec);
            if (st != 204) return st;
        }

        await q(`
            update object
            set deleted = $2
            where id = $1
        `, [id, spec.deleted]);

        return 204;
    }

    async _update_owner (q, id, from, to) {
        this.log("OWNER CHANGE: %s %s", from.owner, to.owner);
        /* We must have TakeFrom the old owner and GiveTo the new owner.
         * Everyone implicitly has: TakeFrom Self; GiveTo Self, Unowned.
         */
        const f_ok = from.owner == await this.client_uuid()
            || await this.check_acl(Perm.TakeFrom, from.owner);
        const t_ok = to.owner == SpecialObj.Unowned
            || to.owner == await this.client_uuid()
            || await this.check_acl(Perm.GiveTo, to.owner);
        if (!f_ok || !t_ok) return 403;

        const owner = await this._obj_id(q, to.owner);
        if (!owner) return 409;

        await q(`update object set owner = $2 where id = $1`, [id, owner]);
        return 204;
    }

    async _class_of_rank (q, uuid, rank) {
        const klass = await _q_row(q, `
            select id from object c
            where c.uuid = $1 and c.rank = $2
        `, [uuid, rank]);
        if (!klass) return;
        return klass.id;
    }

    /* We know the rank is not changing */
    async _update_class (q, id, spec) {
        const klass = await this._class_of_rank(q, spec.class, spec.rank + 1);
        if (!klass) return 409;

        if (!await this._class_has(q, klass, "all_membership", id))
            await this._class_add(q, klass, "membership", id);
        await q(`update object set class = $2 where id = $1`, [id, klass]);
        return 204;
    }
    
    /* When updating an object's rank:
     * - All members and subclasses are updated, to full depth.
     * - This must not cause objects to go below rank 0.
     * - These children must not be direct members or subclasses of any
     *   object outside the set of children, except rank classes.
     * - The object updated becomes subclass of the rank class.
     * - The object updated becomes a member of its primary class only.
     */
    async _to_from_individual (q, id, spec) {
        const klass = await this._class_of_rank(q, spec.class, spec.rank + 1);
        if (!klass) return 409;

        if (spec.rank == 0) {
            const kids = await _q_row(q,
                `select count(*) n from any_child where class = $1`, [id]);
            if (kids.n > 0) return 409;
        }

        await q(`delete from membership where id = $1`, [id]);
        await q(`delete from subclass where id = $1`, [id]);
        await this._class_add(q, klass, "membership", id);

        await q(`update object set rank = $2, class = $3 where id = $1`,
            [id, spec.rank, klass]);
        await this._add_rank_superclass(q, id);

        return 204;
    }

    _update_rank_find_kids (q, id) {
        return q(`
            create temporary table rank_update
            on commit drop
            as with recursive kid as (
                select id class, id from all_class
                union select p.class, c.id
                    from kid p
                        join any_child c on c.class = p.id)
            select distinct o.id, o.rank
                from kid k
                    join object o on o.id = k.id
                where k.class = $1

        `, [id]);
    }

    async _update_rank_checks (q, delta) {
        const too_low = await _q_row(q, `
            select count(*) n from rank_update where rank + $1 < 0`, [delta]);
        if (too_low.n > 0) return false;

        const unrelated = await _q_row(q, `
            select count(*) n
            from rank_update u
                join any_child c on c.id = u.id
            where c.class not in (
                select id from rank_update
                union select id from rank)`);
        if (unrelated.n > 0) return false;

        return true;
    }

    async _update_rank (q, id, info, spec) {
        if (info.rank == 0 || spec.rank == 0)
            return this._to_from_individual(q, id, spec);

        /* XXX For now disable this code; it isn't complete. We need to
         * decide what the desired behaviour is here: do we update
         * existing children, abandon them, or forbid them? */
        return 409;

//        const delta = spec.rank - info.rank;
//
//        await this._update_rank_find_kids(q, id);
//        const ok = await this._update_rank_checks(q, delta);
//        if (!ok) return fail;
    }

    /* Object creation must supply a class */
    async object_create(spec) {
        /* Setting rank via object_create is forbidden */
        if (spec.rank) return [422];

        const [st, config] = await this.db.txn({}, async q => {
            const [st, id] = await this._object_create(q, spec);
            if (st > 299) return [st];

            await q(`call update_registration($1)`, [id]);
            const info = await this._config_get(q, ObjID.Registration, id)
                .then(r => r?.json);

            return [st, info];
        });

        if (st < 299) {
            this.updates.next({
                type:   "config",
                app:    App.Registration,
                object: config.uuid,
                config,
            });
            this.updates.next({ type: "class" });
        }
        return [st, config];
    }

    async _object_create (q, spec) {
        if (spec.uuid) {
            const id = await this._obj_id(q, spec.uuid);
            if (id) {
                const st = await this.update_registration(q, id, 
                    { ...spec, deleted: false });

                return [(st === 204 ? 200 : st), id];
            }
        }

        if (!spec.class) return [422];
        const c_id = await this._obj_id(q, spec.class);
        if (!c_id) return [409];

        const ok = spec.owner == SpecialObj.Unowned
            || spec.owner == await this.client_uuid()
            || await this.check_acl(Perm.GiveTo, spec.owner);
        if (!ok) return [403];

        const o_id = await this._obj_id(q, spec.owner);
        if (!o_id) return [409];

        const obj = await (spec.uuid
            ? this._object_create_uuid(q, spec.uuid, c_id, o_id)
            : this._object_create_new(q, c_id, o_id))

        await this._class_add(q, c_id, "membership", obj.id);
        await this._add_rank_superclass(q, obj.id);
        return [201, obj.id];
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
            this.updates.next({ type: "config", app, object });
        this.updates.next({ type: "config", app: App.Registration, object });
        this.updates.next({ type: "class" });
        return [st];
    }

    class_list () {
        return _q_uuids(this.db.query.bind(this.db), `
            select o.uuid
            from all_class k join object o on o.id = k.id
        `)
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
        return !!dbr.rows.length;
    }

    async _class_relation (klass, obj, perform) {
        const st = await this.db.txn({}, async query => {
            const c = await this._obj_info(query, klass);
            const o = await this._obj_info(query, obj);
            if (c == null || o == null)
                return 404;
            return perform(query, c, o);
        }).catch(e => {
            this.log("Class update failed: %s", e);
            return 409;
        }) ?? 204;

        /* We send a single notification for all updates. The watcher
         * needs to look up the current state each time. */
        if (st < 300)
            this.updates.next({ type: "class" });
        return st;
    }

    class_add_member (klass, obj) {
        return this._class_relation(klass, obj, async (q, c, o) => {
            if (c.rank != o.rank + 1)
                throw "Class must be one rank above member";
            await this._class_add(q, c.id, "membership", o.id);
        });
    }
    class_remove_member (klass, obj) {
        return this._class_relation(klass, obj, async (q, c, o) => {
            await this._class_remove(q, c.id, "membership", o.id);
            if (!await this._class_has(q, o.class, "all_membership", o.id))
                throw "Cannot remove object from primary class";
        });
    }
    class_add_subclass (klass, obj) {
        return this._class_relation(klass, obj, async (q, c, o) => {
            if (o.rank == 0)
                throw "Individuals cannot be subclasses";
            if (c.rank != o.rank)
                throw "Subclasses must match in rank";
            await q(`
                delete from subclass r
                using all_subclass s
                where s.id = $1
                    and s.class = r.class
                    and r.id = $2
            `, [c.id, o.id]);
            await this._class_add(q, c.id, "subclass", o.id);
        });
    }
    class_remove_subclass (klass, obj) {
        return this._class_relation(klass, obj, async (q, c, o) => {
            if (o.rank == 0) return 404;
            await this._class_remove(q, c.id, "subclass", o.id);
            const { ok } = await _q_row(q, `
                select exists(select 1 from subclass where id = $1)
                    or exists(select 1 from rank where id = $1)
                    ok
            `, [o.id]);
            if (!ok)
                await this._add_rank_superclass(q, o.id);
        });
    }

    config_list (app) {
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

    config_class_list(app, klass) {
        return this.db.txn({}, async query => {
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

    _config_get (q, app, object) {
        return _q_row(q, `
            select c.id, c.json, c.etag
            from config c
            where c.app = $1 and c.object = $2
        `, [app, object]);
    }

    config_get(q) {
        return _q_row(this.db.query.bind(this.db), `
            select c.json config, c.etag
            from config c
                join object a on a.id = c.app
                join object o on o.id = c.object
            where a.uuid = $1
                and o.uuid = $2
        `, [q.app, q.object]);
    }

    config_get_all (app) {
        return this.db.txn({}, async query => {
            const app_id = await this._app_id(query, app);
            if (app_id == null) return null;

            return _q_set(query, `
                select o.uuid object, c.json config, c.etag
                from config c
                    join object o on o.id = c.object
                where c.app = $1
            `, [app_id]);
        });
    }

    async _config_validate (query, { app, object, config, special }) {
        const schema = await this.find_schema(query, app);
        if (schema && !schema(config))
            return 422;
        if (special?.validate) {
            const st = await special.validate(query, object, config);
            if (st > 299) return st;
        }
        return 204;
    }

    /* The caller must pass (in opts):
     * app, object      object ids (not UUIDs)
     * config           the new config
     * old              the id in the config table of the existing entry
     * special          a SpecialApp, or undefined
     * Etags must be already checked. 
     * We will return 299 to indicate a successful no-change update.
     */
    async _config_put (query, opts) {
        const valid = await this._config_validate(query, opts);
        if (valid > 299) return valid;

        /* Don't rely on node-postgres, it will pass through a bare
         * string without stringifying it again. */
        const json = JSON.stringify(opts.config);
            
        if (opts.old) {
            const ok = await query(`
                update config as c
                set json = $2, etag = default
                where id = $1 and json != $2
                returning 1 ok
            `, [opts.old, json]);

            return ok.rowCount ? 204 : 299;
        }

        await query(`
            insert into config (app, object, json)
            values ($1, $2, $3)
        `, [opts.app, opts.object, json]);

        return 201;
    }

    async config_put(q, config, check_etag) {
        const special = this.get_special(q.app);

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

        if (rv < 299) {
            this.emit_change(q);
            this.updates.next({ ...q, type: "config", config });
            special?.notify(q.object, q.config);
        }
        /* Fixup our fake status code */
        return rv == 299 ? 204 : rv;
    }

    async config_delete(q, check_etag) {
        const special = this.get_special(q.app);

        const rv = await this.db.txn({}, async query => {
            const conf = await _q_row(query, `
                select c.id, c.etag, c.object
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
                const st = special.delete(query, conf.object);
                if (st > 299) return st;
            }

            await query(`delete from config where id = $1`, [conf.id]);
            return 204;
        });

        if (rv == 204) {
            this.emit_change(q);
            this.updates.next({ ...q, type: "config" });
            special?.notify(q.app, q.config);
        }
        return rv;
    }

    async config_merge_patch (q, patch, check_etag) {
        const special = this.get_special(q.app);

        const [st, config] = await this.db.txn({}, async query => {
            const app = await this._app_id(query, q.app);
            const object = await this._obj_id(query, q.object);
            if (!app || !object) return [404];

            const old = await this._config_get(query, app, object);

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
        /* 299 is returned by _config_put for 'no change made' */
        if (st < 299) {
            this.emit_change({ app: q.app, config });
            this.updates.next({ type: "config", app: q.app, object: q.object, config });
            special?.notify(q.object, q.config);
        }
        return st == 299 ? 204 : st;
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
        const k_join = klass ? `join all_membership m on m.id = o.id` : "";
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

    async _dump_load_obj_v1 (dump) {
        const creat = (u, c) => this.object_create({
            uuid: u, class: c, owner: SpecialObj.Unowned });

        /* The order of loading here is important. This is why Classes
         * are handled separately from the others. */
        for (const uuid of dump.classes ?? []) {
            /* XXX temporary hack while the ACS dumps attempt to create
             * this class */
            if (uuid == Class.Class)
                continue;
            this.log("LOAD v1 CLASS %s", uuid);
            const [st] = await creat(uuid, Class.Class);
            if (st > 299) {
                this.log("Dump failed [%s] on class %s", st, uuid);
                return st;
            }
        }
        for (const [klass, objs] of Object.entries(dump.objects ?? {})) {
            for (const uuid of objs) {
                this.log("LOAD v1 OBJECT %s/%s", klass, uuid);
                let [st] = await creat(uuid, klass);
                if (st > 299) {
                    this.log("Dump failed [%s] on object %s (%s)",
                        st, uuid, klass);
                    return st;
                }
            }
        }
        return 204;
    }

    _dump_load_obj_v2 (dump) {
        /* XXX This txn should include the configs. */
        return this.db.txn({}, q => q(`select load_dump($1)`, [dump.objects]))
            .then(() => 204)
            .catch(e => {
                this.log("Dump failed: %s", e);
                return 409;
            });
    }

    /* The dump must have already been validated */
    async dump_load(dump) {
        /* XXX This loads the dump in multiple transactions, which is
         * not ideal. But loading in one transaction, with the
         * additional logic involved, means reworking all the
         * transaction handling. Maybe later... */

        const v = dump.version;
        const st = await (
            v == 1 ? this._dump_load_obj_v1(dump)
            : v == 2 ? this._dump_load_obj_v2(dump)
            : 422);
        if (st > 299) return st;

        for (const [app, objs] of Object.entries(dump.configs ?? {})) {
            for (const [object, conf] of Object.entries(objs)) {
                this.log("LOAD CONFIG %s/%s", app, object);
                const st = await this.config_put({app, object}, conf);
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
