/*
 * Factory+ NodeJS Utilities
 * Auth service interface.
 * Copyright 2022 AMRC.
 */

import * as semver from "semver";

import { Address } from "../sparkplug/util.js";

import { App, Service, Null as Null_UUID } from "../uuids.js";

import { ServiceInterface } from "./service-interface.js";

export class Auth extends ServiceInterface {
    constructor (fplus) {
        super(fplus);

        this.service = Service.Authentication;
        this.root_principal = fplus.opts.root_principal;
        this.permission_group = fplus.opts.permission_group;
    }
    
    /* Verifies if principal has permission on target. If 'wild' is true
     * then the null UUID in an ACE will match any target. */
    async check_acl (principal, permission, target, wild) {
        const acl = await this.fetch_acl(principal, this.permission_group);
        return acl(permission, target, wild);
    }

    /* Takes a principal and a permission group. Returns a function
     * which checks a particular permission and target against the
     * returned ACL. */
    async fetch_acl (princ_req, group) {
        const [type, principal] =
            typeof(princ_req) == "string"   ? ["kerberos", princ_req]
            : "kerberos" in princ_req       ? ["kerberos", princ_req.kerberos]
            : "uuid" in princ_req           ? ["uuid", princ_req.uuid]
            : [null, null];
        if (type == null) {
            this.debug.log("acl", 
                "Unrecognised principal request: %o", princ_req);
            return () => false;
        }
        const by_uuid = type == "uuid";

        if (this.root_principal 
            && type == "kerberos" 
            && principal == this.root_principal)
            return () => true;

        const res = await this.fplus.fetch({
            service:    Service.Authentication,
            url:        "/authz/acl",
            query:      { principal, permission: group, "by-uuid": by_uuid },
        });
        if (!res.ok) {
            this.debug.log("acl", `Failed to read ACL for ${principal}: ${res.status}`);
            return () => false;
        }
        const acl = await res.json();
        this.debug.log("acl", "Got ACL for %s: %o", principal, acl);

        return (permission, target, wild) => 
            acl.some(ace => 
                ace.permission == permission
                && (ace.target == target
                    || (wild && ace.target == Null_UUID)));
    }

    /* Resolve a principal to a UUID. Query is an object with a single
     * key; currently this must be 'kerberos' to search for principals
     * by Kerberos principal name. */
    async resolve_principal (query) {
        const res = await this.fplus.fetch({
            service:    Service.Authentication,
            url:        "/authz/principal/find",
            query,
        });
        if (!res.ok) {
            this.debug.log("princ", 
                "Failed to resolve %o: %s", query, res.status);
            return null;
        }
        const uuid = await res.json();
        this.debug.log("princ", "Resolved %o to %s", query, uuid);
        return uuid;
    }

    async _resolve_by_addr (address) {
        const cdb = this.fplus.ConfigDB;

        /* Check for a version of the ConfigDB that can search for
         * not-existing keys. Otherwise we will get false results. */
        const ping = await cdb.ping();
        if (!ping || !semver.satisfies(ping.version, ">=1.7 || =1.7.0-bmz")) {
            this.debug.log("princ", 
                `ConfigDB is too old to search for addresses (${ping.version})`);
            return;
        }

        const uuids = await cdb.search(App.SparkplugAddress, {
            group_id:   address.group,
            node_id:    address.node,
            device_id:  undefined,
        });
        if (uuids.length == 1) return uuids;
        if (uuids.length)
            this.debug.log("princ",
                "Multiple results resolving Sparkplug address %s",
                address);
        return;
    }

    /** Fetch the different identities for a principal. 
     *
     * With the current version of the auth service Sparkplug identities
     * are stored in the ConfigDB and must be resolved from there. This
     * means more queries than are strictly necessary.
     *
     * @param kind Specifies the type of identifier we have already:
     *  "kerberos", "uuid" or "sparkplug". If omitted this will look up
     *  our client identities.
     * @param identifier The identifier we have. Kerberos and UUID
     *  identifiers must be supplied as a string. Sparkplug identifiers
     *  can be either a string or an Address.
     * @return An object with one or more of those keys giving all the
     *  principal's identities we have access to, or null if we cannot
     *  resolve the principal (no permission or doesn't exist).
     */
    async find_principal (kind, identifier) {
        const uuid = 
            kind == undefined ? await this.resolve_principal()
            : kind == "uuid" ? identifier
            : kind == "kerberos"
                ? await this.resolve_principal({kerberos: identifier})
            : kind == "sparkplug"
                ? await this._resolve_by_addr(identifier)
            : undefined;

        if (uuid == undefined) return;

        const [st, ids] = await this.fetch(`/authz/principal/${uuid}`);
        if (st != 200) {
            this.debug.log("princ", "Failed to fetch principal %s: %s",
                uuid, st);
            return;
        }

        const sp = await this.fplus.ConfigDB
            .get_config(App.SparkplugAddress, uuid);
        if (sp)
            ids.sparkplug = new Address(sp.group_id, sp.node_id);

        return ids;
    }

    async add_principal (uuid, kerberos) {
        const [st] = await this.fetch({
            method:     "POST",
            url:        "authz/principal",
            body:       { uuid, kerberos },
        });
        if (st != 204)
            this.throw(`Can't create principal ${kerberos}`, st);
    }

    /* Returns true if we deleted a principal, false if the principal
     * didn't exist. */
    async delete_principal (uuid) {
        const [st] = await this.fetch({
            method:     "DELETE",
            url:        `authz/principal/${uuid}`,
        });
        switch (st) {
            case 204:   return true;
            case 404:   return false;
            default:
                this.throw(`Can't delete principal ${uuid}`, st);
        }
    }

    async create_principal (klass, kerberos, name) {
        const cdb = this.fplus.ConfigDB;
        const uuid = await cdb.create_object(klass);
        try {
            await this.add_principal(uuid, kerberos);
        }
        catch (e) {
            await cdb.put_config(App.Info, uuid, {
                name, deleted: true,
            });
            throw e;
        }
        if (name)
            await cdb.put_config(App.Info, uuid, { name });
        return uuid;
    }

    /* This is of limited use; you can only call it if you have wildcard
     * Manage_ACL permission. So a root-equivalent administrator. */
    async get_all_ace () {
        const [st, aces] = await this.fetch("authz/ace");
        if (st != 200)
            this.throw(`Can't read ACEs`, st);
        return aces;
    }

    async _edit_ace (spec) {
        const [st] = await this.fetch({
            method:     "POST",
            url:        "authz/ace",
            body:       spec,
        });
        if (st != 204)
            this.throw(`Can't ${spec.action} ACE`, st);
    }

    /* XXX This is a bad API. These should be HTTP methods rather than a
     * generic POST request. */
    async add_ace (principal, permission, target) {
        await this._edit_ace({
            action: "add", 
            principal, permission, target,
        });
    }

    async delete_ace (principal, permission, target) {
        await this._edit_ace({
            action: "delete",
            principal, permission, target,
        });
    }

    async add_to_group (group, member) {
        const [st] = await this.fetch({
            method:     "PUT",
            url:        `authz/group/${group}/${member}`,
        });
        if (st != 204)
            this.throw(`Can't add ${member} to group ${group}`, st);
    }

    async remove_from_group (group, member) {
        const [st] = await this.fetch({
            method:     "DELETE",
            url:        `authz/group/${group}/${member}`,
        });
        if (st != 204)
            this.throw(`Can't remove ${member} from group ${group}`, st);
    }
}
