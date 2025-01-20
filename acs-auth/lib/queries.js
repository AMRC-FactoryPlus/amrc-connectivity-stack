/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Database queries class.
 * Copyright 2022 AMRC
 */

import { Special } from "./uuids.js";

/* Queries is a separate class, because sometimes we want to query on
 * the database directly, and sometimes we need to query using a query
 * function for a transaction. The model inherits from this class. */
export default class Queries {
    static DBVersion = 1;

    constructor (query) {
        this.query = query;
    }

    /* This takes a principal id. Right now this is a UUID, but it
     * should change to a DB unique ID soon... Don't rely on it, just
     * use principal_by_krb or principal_by_uuid and pass back what you get. */
    async acl_get (princ_id, permission) {
        /* XXX This query, with a setof function to resolve the group
         * members, is incorrect. If I normalise to a table of UUIDs
         * then I can make it an ordinary left join. */
        const dbr = await this.query(`
            select a.permission, 
                case a.target
                    when '${Special.Self}'::uuid then a.principal
                    else a.target
                end target
            from resolved_ace a
            where a.principal = $1
                and a.permission in (
                    select members_of($2::uuid))
        `, [princ_id, permission]);

        return dbr.rows;
    }

    async ace_get_all () {
        const dbr = await this.query(`
            select ace.principal, ace.permission, ace.target
            from ace
        `);
        return dbr.rows;
    }

    async ace_add (ace) {
        await this.query(`
            insert into ace (principal, permission, target)
            values ($1, $2, $3)
            on conflict do nothing
        `, [ace.principal, ace.permission, ace.target]);
        return 204;
    }

    async ace_delete (ace) {
        await this.query(`
            delete from ace
            where principal = $1
                and permission = $2
                and target = $3
        `, [ace.principal, ace.permission, ace.target]);
        return 204;
    }

    /* This returns a UUID. Soon it will return an integer ID. */
    async principal_by_krb (principal) {
        const dbr = await this.query(`
            select p.uuid from principal p
            where p.kerberos = $1
        `, [principal]);
        return dbr.rows[0]?.uuid;
    }

    /* This returns a UUID. Soon it will return an integer ID. */
    async principal_by_uuid (uuid) {
        /* I am allowing principal UUIDs that don't have a Kerberos
         * principal. This is needed ATM for command escalation; there
         * isn't a 1-1 mapping between Nodes and Kerberos principals,
         * and NDATA-style cmdesc needs command escalation rights to be
         * granted to the Node, not the user account behind it. */
        return uuid;
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
            select uuid, kerberos
            from principal
            where uuid = $1
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
            select uuid
            from principal
            where kerberos = $1
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

