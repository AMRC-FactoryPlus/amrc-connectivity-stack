/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Database queries class.
 * Copyright 2022 AMRC
 */

import util from "util";

import { Special } from "./uuids.js";
import { has_wild } from "./validate.js";

/* This must match the \sets in sql/v2.sql */
const IDs = {
    Kerberos:           1,
    Sparkplug:          2,
    Principal:          3,
    PrincipalGroup:     4,
    Permission:         5,
    PermissionGroup:    6,
    Self:               7,
};

class QueryError extends Error {
    constructor (sql, bind, msg, ...args) {
        super(util.format(msg, ...args));
        this.status = 500;
        this.sql = sql;
        this.bind = bind;
    }

    static throw (...args) {
        throw new this(...args);
    }
}

class OnlyOneError extends QueryError {
    constructor (sql, bind, n) {
        super(sql, bind, "Query returned %s rows instead of 1", n);
    }

    static check (dbr, sql, bind) {
        if (dbr.rowCount > 1)
            this.throw(sql, bind, dbr.rowCount);
    }
}

/* Queries is a separate class, because sometimes we want to query on
 * the database directly, and sometimes we need to query using a query
 * function for a transaction. The model inherits from this class. */
export default class Queries {
    static DBVersion = 2;

    constructor (query) {
        this.query = query;
    }

    async q_rows (sql, bind) {
        const dbr = await this.query(sql, bind);
        return dbr.rows;
    }
    async q_row (sql, bind) {
        const dbr = await this.query(sql, bind);
        OnlyOneError.check(dbr, sql, bind);
        return dbr.rows[0];
    }
    async q_single (text, values) {
        const dbr = await this.query({ text, values, rowMode: "array" });
        OnlyOneError.check(dbr, text, values);
        return dbr.rows[0]?.[0];
    }
    async q_list (text, values) {
        const dbr = await this.query({ text, values, rowMode: "array" });
        return dbr.rows.map(r => r[0]);
    }

    /* This takes a principal id. Right now this is a UUID, but it
     * should change to a DB unique ID soon... Don't rely on it, just
     * use principal_by_krb or principal_by_uuid and pass back what you get. */
    async acl_get (princ_id, permission) {
        /* This is a mess to keep authz/acl working for now. This
         * expands all groups regardless as before. This goes
         * round-the-houses from IDs to UUIDs and back. */
        const dbr = await this.query(`
            with recursive
                aceu as (
                    select u.uuid principal, p.uuid permission, t.uuid target, e.plural
                    from ace e
                        join uuid u on u.id = e.principal
                        join uuid p on p.id = e.permission
                        join uuid t on t.id = e.target),
                group_members as (
                    select m.parent, m.parent child
                        from old_member m
                    union select g.parent, m.child
                        from group_members g
                            join old_member m on m.parent = g.child),
                resolved_ace as (
                    select coalesce(princ.child, a.principal) principal, 
                        coalesce(perm.child, a.permission) permission,
                        coalesce(targ.child, a.target) target
                    from aceu a
                        left join group_members princ on princ.parent = a.principal
                        left join group_members perm on perm.parent = a.permission
                        left join group_members targ on targ.parent = a.target),
                full_acl as (
                    select u.id princid, a.principal, a.permission, 
                        case a.target 
                            when '5855a1cc-46d8-4b16-84f8-ab3916ecb230'::uuid
                                then a.principal
                            else a.target
                        end target
                    from resolved_ace a
                        join uuid u on u.uuid = a.principal)
            select a.principal, a.permission, a.target
            from full_acl a
                left join group_members g on g.child = a.permission
            where a.princid = $1 and g.parent = $2
        `, [princ_id, permission]);

        return dbr.rows;
    }

    async uuid_find (uuid) {
        return await this.q_single(
                `select id from uuid where uuid = $1`,
                [uuid])
            ?? await this.q_single(
                `insert into uuid (uuid) values ($1) returning id`,
                [uuid]);
    }

    async grant_find (uuid, permitted) {
        const g = await this.q_row(`
            select e.id, p.uuid permission
            from ace e
                join uuid p on p.id = e.permission
            where e.uuid = $1
        `, [uuid]);
        if (!g) return [404];
        if (!has_wild(permitted, g.permission)) return [403];
        return [200, g.id];
    }

    grant_list () {
        return this.q_list(`select uuid from ace`);
    }

    grant_get (uuid) {
        /* XXX I don't like this duplication */
        return this.q_row(`
            select e.uuid, u.uuid principal, p.uuid permission, t.uuid target,
                e.plural
            from ace e
                join uuid u on u.id = e.principal
                join uuid p on p.id = e.permission
                join uuid t on t.id = e.target
            where e.uuid = $1
        `, [uuid]);
    }

    grant_get_all () {
        return this.q_rows(`
            select e.uuid, u.uuid principal, p.uuid permission, t.uuid target,
                e.plural
            from ace e
                join uuid u on u.id = e.principal
                join uuid p on p.id = e.permission
                join uuid t on t.id = e.target
        `);
    }

    async grant_resolve_uuids (g) {
        /* XXX These cannot run in parallel as we are in a txn and only
         * have a single Pg connection. */
        return Promise.all(
            [g.principal, g.permission, g.target]
                .map(u => this.uuid_find(u)));
    }

    async grant_new (g) {
        const ids = await this.grant_resolve_uuids(g);
        const uuid = await this.q_single(`
            insert into ace (principal, permission, target, plural)
            values ($1, $2, $3, $4)
            returning uuid
        `, [...ids, g.plural]);
        return { status: 201, uuid };
    }

    grant_delete (id) {
        return this.q_single(
            `delete from ace where id = $1`,
            [id]);
    }

    async grant_update (id, g) {
        const ids = await this.grant_resolve_uuids(g);
        return this.q_single(`
            update ace
            set principal = $2, permission = $3, target = $4, plural = $5
            where id = $1
            returning 1 ok
        `, [id, ...ids, g.plural]);
    }

    async ace_add (ace) {
        throw "unimplemented";
    }

    async ace_delete (ace) {
        throw "unimplemented";
    }

    /* This returns an ID. */
    async principal_by_krb (principal) {
        const dbr = await this.query(`
            select i.principal 
            from identity i
            where i.kind = ${IDs.Kerberos} and i.name = $1
        `, [principal]);
        return dbr.rows[0]?.principal;
    }

    /* This returns an ID. */
    async principal_by_uuid (uuid) {
        /* I am allowing any object to be a principal at this point. */
        const dbr = await this.query(`
            select id from uuid where uuid = $1
        `, [uuid]);
        return dbr.rows[0].id;
    }

    idkind_find (kind) {
        return this.q_single(
            `select id from idkind where kind = $1`, [kind]);
    }

    identity_get_all () {
        return this.q_rows(`
            select u.uuid, k.kind, i.name
            from identity i
                join uuid u on u.id = i.principal
                join idkind k on k.id = i.kind
        `);
    }

    async identity_add (pid, kid, name) {
        const dbr = await this.query(`
            insert into identity (principal, kind, name)
            values ($1, $2, $3)
            on conflict do nothing
            returning 1 ok
        `, [pid, kid, name]);
        return dbr.rows[0]?.ok ? 204 : 409;
    }

    async identity_delete (uuid, kind) {
        const dbr = await this.query(`
            delete from identity i
            using uuid u, idkind k
            where i.principal = u.id
                and i.kind = k.id
                and u.uuid = $1
                and k.kind = $2
            returning 1 ok
        `, [uuid, kind]);
        return dbr.rows[0]?.ok ? 204 : 404;
    }

    async group_all () {
        const dbr = await this.query(`
            select parent, child from old_member
        `,);
        return dbr.rows;
    }

    async group_delete (group, member) {
        await this.query(`
            delete from old_member
            where parent = $1
                and child = $2
        `, [group, member]);
        return 204;
    }

    group_list () {
        return this.q_list(`
            select distinct parent from old_member
        `);
    }

    group_get (group) {
        return this.q_list(`
            select child from old_member
            where parent = $1
        `, [group]);
    }

    async effective_get (principal) {
        const dbr = await this.query(`
            select p.kerberos, a.principal, a.permission,
                case a.target
                    when '${Special.Self}'::uuid then a.principal
                    else a.target
                end target
            from resolved_ace a
                join principal p on a.principal = p.uuid
            where p.kerberos = $1
        `, [principal]);
        return dbr.rows;
    }

    dump_load_uuids (uuids) {
        return this.q_list(`
            insert into uuid (uuid)
            select u.uuid
            from unnest($1::uuid[]) u(uuid)
            on conflict do nothing
            returning uuid
        `, [[...uuids]]);
    }

    dump_load_krbs (krbs) {
        return this.q_list(`
            insert into identity (principal, kind, name)
            select u.id, 1, i.i->>'kerberos'
            from unnest($1::jsonb[]) i(i)
                join uuid u on u.uuid::text = i.i->>'uuid'
            except select principal, kind, name from identity
            returning name
        `, [krbs]);
    }

    /* XXX This form of loading gives no way for a revised version of a
     * dump to remove old grants. This is a problem across the board
     * with our dump loading logic but is more important here. I think
     * the only solution that works is to introduce a 'source' for these
     * entries such that loading a new dumps clears old data from that
     * source. Moving the grants into the ConfigDB would make it easier
     * to solve this in general. */
    dump_load_aces (aces) {
        return this.q_rows(`
            insert into ace (principal, permission, target, plural)
            select u.id, p.id, t.id, 
                coalesce((g.g->'plural')::boolean, false)
            from unnest($1::jsonb[]) g(g)
                join uuid u on u.uuid::text = g.g->>'principal'
                join uuid p on p.uuid::text = g.g->>'permission'
                join uuid t on t.uuid::text = g.g->>'target'
            on conflict (principal, permission, target) do update
                set plural = excluded.plural
                where ace.plural != excluded.plural
            returning principal, permission, target
        `, [aces]);
    }

    async do_dump_load (uuids, krbs, grants) {
    }
}

