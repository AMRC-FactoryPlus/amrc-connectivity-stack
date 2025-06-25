/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Database queries class.
 * Copyright 2022 AMRC
 */

import util from "util";

class QueryError extends Error {
    constructor (sql, bind, msg, ...args) {
        super(util.format(msg, ...args));
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
        if (!permitted(g.permission)) return [403];
        return [200, g.id];
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

    /* This returns 201 for a new grant, 200 for an exact duplicate, and
     * 409 otherwise. There is a slight risk here of one client
     * 'stealing' another's grant; I think the only solution would be
     * ownership of grants. */
    /* XXX This logic should be in model. */
    async grant_new (g) {
        const ids = await this.grant_resolve_uuids(g);
        const bind = [...ids, g.plural];

        const existing = await this.q_single(`
            select uuid
            from ace
            where principal = $1
                and permission = $2
                and target = $3
                and plural = $4
        `, bind);
        if (existing) return { status: 200, uuid: existing };

        const uuid = await this.q_single(`
            insert into ace (principal, permission, target, plural)
            values ($1, $2, $3, $4)
            on conflict do nothing
            returning uuid
        `, bind);

        if (!uuid) return { status: 409 };
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

    identity_add (pid, kid, name) {
        return this.query(`
            insert into identity (principal, kind, name)
            values ($1::integer, $2::integer, $3::text)
            except select principal, kind, name from identity
        `, [pid, kid, name])
            .then(() => 204)
            .catch(e => e?.code == "23505" ? 409 : Promise.reject(e));
    }

    async identity_delete (uuid, kind) {
        const ok = await this.q_single(`
            delete from identity i
            using uuid u, idkind k
            where i.principal = u.id
                and i.kind = k.id
                and u.uuid = $1
                and k.kind = $2
            returning 1 ok
        `, [uuid, kind]);
        return ok ? 204 : 404;
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

    dump_load_aces (aces) {
        return this.q_rows(`
            with n_ace as (
                select u.id princ, p.id perm, t.id targ,
                    coalesce((g.g->'plural')::boolean, false) plural
                from unnest($1::jsonb[]) g(g)
                    join uuid u on u.uuid = (g.g->>'principal')::uuid
                    join uuid p on p.uuid = (g.g->>'permission')::uuid
                    join uuid t on t.uuid = (g.g->>'target')::uuid
            ),
            existing as (
                select e.id 
                from n_ace n join ace e
                    on e.principal = n.princ
                        and e.permission = n.perm
                        and e.target = n.targ
            ),
            d_ace as (
                delete from ace
                where principal in (select princ from n_ace)
                    and id not in (select id from existing)
                returning id
            ),
            i_ace as (
                insert into ace (principal, permission, target, plural)
                on conflict (principal, permission, target) do update
                    set plural = excluded.plural
                    where ace.plural != excluded.plural
                returning id
            ),
            select id from d_ace
                union all select id from i_ace
        `, [aces]);
    }
}

