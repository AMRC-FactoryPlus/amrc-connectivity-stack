/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Database queries class.
 * Copyright 2022 AMRC
 */

import { Special } from "./uuids.js";

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

/* Queries is a separate class, because sometimes we want to query on
 * the database directly, and sometimes we need to query using a query
 * function for a transaction. The model inherits from this class. */
export default class Queries {
    static DBVersion = 2;

    constructor (query) {
        this.query = query;
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
                    select u.id principal, a.permission, 
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
            where a.principal = $1 and g.parent = $2
        `, [princ_id, permission]);

        return dbr.rows;
    }

    async ace_get_all () {
        const dbr = await this.query(`
            select e.uuid, u.uuid principal, p.uuid permission, t.uuid target,
                e.plural
            from ace e
                join uuid u on u.id = e.principal
                join uuid p on p.id = e.permission
                join uuid t on t.id = e.target
        `);
        return dbr.rows;
    }

    async ace_add (ace) {
        await this.query(`
            insert into uuid (uuid)
            select uuid
            from unnest($1::uuid[]) n(uuid)
            on conflict (uuid) do nothing
        `, [[ace.principal, ace.permission, ace.target]]);
        await this.query(`
            insert into ace (principal, permission, target, plural)
            select u.id, p.id, t.id, $4
            from uuid u, uuid p, uuid t
            where u.uuid = $1 and p.uuid = $2 and t.uuid = $3
            on conflict do nothing
        `, [ace.principal, ace.permission, ace.target, ace.plural ?? false]);
        return 204;
    }

    async ace_delete (ace) {
        throw "unimplemented";
        await this.query(`
            delete from ace
            where principal = $1
                and permission = $2
                and target = $3
        `, [ace.principal, ace.permission, ace.target]);
        return 204;
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

    async principal_get_all () {
        const dbr = await this.query(`
            select p.uuid, p.kerberos from principal p
        `);
        return dbr.rows;
    }

    async principal_list () {
        const dbr = await this.query(`
            select kerberos from principal 
        `);
        return dbr.rows.map(r => r.kerberos);
    }

    async principal_add (princ) {
        const dbr = await this.query(`
            insert into principal (uuid, kerberos)
            values ($1, $2)
            on conflict do nothing
            returning 1 ok
        `, [princ.uuid, princ.kerberos]);
        return dbr.rows[0]?.ok ? 204 : 409;
    }

    async principal_get (uuid) {
        const dbr = await this.query(`
            select u.uuid, i.name kerberos
            from identity i
                join uuid u on u.id = i.principal
            where i.kind = ${IDs.Kerberos} and u.uuid = $1
        `, [uuid]);
        return dbr.rows[0];
    }

    async principal_delete (uuid) {
        const dbr = await this.query(`
            delete from principal
            where uuid = $1
            returning 1 ok
        `, [uuid]);
        return dbr.rows[0]?.ok ? 204 : 404;
    }

    async principal_find_by_krb (kerberos) {
        const dbr = await this.query(`
            select u.uuid
            from identity i
                join uuid u on u.id = i.principal
            where i.kind = ${IDs.Kerberos} and i.name = $1
        `, [kerberos]);
        return dbr.rows[0]?.uuid;
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
}

