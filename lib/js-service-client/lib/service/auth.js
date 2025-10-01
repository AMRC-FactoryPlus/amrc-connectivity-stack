/*
 * Factory+ NodeJS Utilities
 * Auth service interface.
 * Copyright 2022 AMRC.
 */

import util from "util";

import { Address } from "../sparkplug/util.js";

import { App, Service, Null as Null_UUID }  from "../uuids.js";
import { WellKnown }                        from "../well-known.js";

import { ServiceInterface, urljoin }        from "./service-interface.js";

/** Interface to the Auth service.

This class provides the interface to the Auth service. Options (provided
via the ServiceCLient) are:

- `root_principal`: A Kerberos UPN which overrides all permission checks.
- `bootstrap_acl`: A string giving ACL entries for bootstrap purposes.
- `bootstrap_uuids`: An object giving names for the bootstrap ACL UUIDs.

The bootstrap ACL is normally provided via the BOOTSTRAP_ACL environment
variable. This is to support services which need some ACL information before the Auth service is available.

The string will be split on newlines and then on colons, with each line
having three fields, principal, permission and target. The principal
must be a Kerberos UPN; no other forms of identity are recognised. The
permission and target are UUIDs but will first be looked up in the
`bootstrap_uuids` objects. No group expansion will be performed as this
is for use before the Auth service is available.

*/
export class Auth extends ServiceInterface {
    constructor (fplus) {
        super(fplus);

        this.service = Service.Authentication;
        this.root_principal = fplus.opts.root_principal;
        this.log = fplus.debug.bound("auth");

        this.bootstrap_acl = this._build_bs_acl(fplus.opts);
    }

    _build_bs_acl (opts) {
        const { bootstrap_acl, bootstrap_uuids } = opts;

        const wk = new WellKnown({ uuids: bootstrap_uuids ?? {} });

        const acl = new Map();
        if (!bootstrap_acl) return acl;

        const entries = bootstrap_acl.split("\n")
            .filter(l => l.length)
            .map(l => l.split(":"))
            .map(([princ, perm, targ]) => 
                [princ, { 
                    permission:     wk.lookup(perm),
                    target:         wk.lookup(targ),
                }]);

        for (const [p, e] of entries) {
            let l = acl.get(p);
            if (!l) {
                l = [];
                acl.set(p, l);
            }
            l.push(e);
        }

        this.debug.log("acl", "Bootstrap ACL: %o", acl);
        return acl;
    }
    
    /** Checks if a principal has a given permission.
     * The principal may be in any form accepted by `decode_principal`.
     *
     * @param principal The principal to check.
     * @param permission The permission UUID to check.
     * @param target The target UUID to check.
     * @param wild A boolean: whether to accept Wildcard targets.
     * @returns A boolean: permitted or not.
     */
    async check_acl (principal, permission, target, wild) {
        const acl = await this.fetch_acl(principal);
        return acl(permission, target, wild);
    }

    /** Normalises different principal formats.
     * Accepted formats are
     * - A plain string, interpreted as a `kerberos` UPN.
     * - A pair [type, name].
     * - An object with a single key.
     * The type is an identity type known to the Auth service, or `uuid`
     * for a principal UUID.
     *
     * @returns A pair [type, name].
     */
    /* XXX This all need refactoring. Probably I want an Identity class
     * which is (type, name) (including `uuid`) and then a Principal
     * which has a list of Identities. */
    decode_principal (req) {
        if (req == null)                return [null, null];
        if (Array.isArray(req))         return req.slice(0, 2);
        if (typeof req == "string")     return ["kerberos", req];
        
        if (typeof req != "object")
            this.throw("Can't decode as identity: %o", req);
        const entries = Object.entries(req);
        if (entries.length != 1)
            this.throw("Can't decode as identity: %o", req);
        return entries[0];
    }

    /* Fetch the ACL for a principal.
     * Returns the ACL in the form of a function accepting (permission,
     * target, wild) and returning boolean. See `check_acl`.
     *
     * @param princ_req Passed to `decode_principal`.
     * @param group Ignored (for compatibility).
     * @returns A function for checking the ACL.
     */
    async fetch_acl (princ_req, group) {
        const [type, principal] = this.decode_principal(princ_req);
        if (type == null)
            this.throw(util.format("Unrecognised principal request: %o", princ_req));

        if (this.root_principal 
            && type == "kerberos" 
            && principal == this.root_principal
        ) {
            this.debug.log("acl", "Principal %s has root access", principal);
            return () => true;
        }

        const acl = (type == "kerberos" && this.bootstrap_acl.has(principal))
            ? this.bootstrap_acl.get(principal)
            : await this.fetch_auth_acl(type, principal);

        this.debug.log("acl", "Got ACL for %s: %o", principal, acl);

        return (permission, target, wild) => 
            acl.some(ace => 
                ace.permission == permission
                && (ace.target == target
                    || (wild && ace.target == Null_UUID)));
    }

    async fetch_auth_acl (type, principal) {
        const url = type == "uuid" ? urljoin("v2", "acl", principal)
            : urljoin("v2", "acl", type, principal);
        const [st, json] = await this.fetch_raw_acl(url);
        if (st != 200) {
            /* XXX I'm not sure what's best to do here. ServiceError has
             * a `status` property holding the status from the failed
             * request; this is obviously useful. But express will now
             * interpret the `status` of an exception as the status to
             * return to the client. I need to separate these two uses
             * somehow. Maybe service-api needs to translate all Auth
             * errors (or all ServiceErrors?) to 503 on principle? */
            this.debug.log("acl", "Failed to read ACL for %s: %s",
                principal, st);
            this.throw(`Failed to read ACL for ${principal}`, 503);
        }
        return json;
    }

    /** Fetch an ACL from the Auth service.
     * This is an override point for RxClient.
     *
     * @param url A URL path under v2/acl
     * @returns An array [status, acl]
     */
    fetch_raw_acl (url) { return this.fetch(url); }

    /** Resolve a principal identity to a UUID.
     * This method calls `resolve_identity`, except for:
     * - Type `null` calls `whoami_uuid`.
     * - Type `uuid` is returned unchanged.
     * - Type `sparkplug` goes to the ConfigDB.
     *
     * @param query Passed to `decode_principal`.
     * @returns A UUID.
     */
    async resolve_principal (query) {
        const [type, name] = this.decode_principal(query);
        if (type == null) return this.whoami_uuid();
        if (type == "uuid") return name;
        if (type == "sparkplug") return this._resolve_by_addr(name);

        return this.resolve_identity(type, name);
    }

    /** Look up an identity.
     * This only supports name types supported directly by the Auth
     * service. Currently this means Kerberos only.
     *
     * @param type The type of name `name` is.
     * @param name The name to look up.
     * @returns A UUID, or `null`.
     */
    async resolve_identity (type, name) {
        const url = urljoin("v2", "identity", type, name);
        const [st, uuid] = await this.fetch(url);
        if (st != 200) {
            this.debug.log("princ", 
                "Failed to resolve %s identity %s: %s", type, name, st);
            return null;
        }
        this.debug.log("princ", "Resolved %s/%s to %s", type, name, uuid);
        return uuid;
    }

    async _resolve_by_addr (address) {
        const cdb = this.fplus.ConfigDB;

        const addr = Address.from(address);
        if (addr.isDevice())
            this.throw("${addr} is a Device address");

        /* Check for a version of the ConfigDB that can search for
         * not-existing keys. Otherwise we will get false results. */
        /* XXX We should cache this. */
        if (!await cdb.version_satisfies(">=1.7")) {
            this.debug.log("princ", `ConfigDB is too old to search for addresses`);
            return;
        }

        return cdb.resolve({
            app:    App.SparkplugAddress,
            query:  {
                group_id:   addr.group,
                node_id:    addr.node,
                device_id:  undefined,
            }});
    }

    /** Fetch all my identities.
     * Call the Auth service to find all my identities, based on my
     * Kerberos UPN.
     *
     * @returns An object keyed by identity type.
     */
    async whoami () {
        const [st, json] = await this.fetch("v2/whoami");
        if (st == 200) return json;
        this.throw("Can't fetch my identities", st);
    }

    /** Fetch my principal UUID.
     * Look up my principal UUID in the Auth service.
     *
     * @returns A UUID.
     */
    async whoami_uuid () {
        const [st, json] = await this.fetch("v2/whoami/uuid");
        if (st == 200) return json;
        this.throw("Can't fetch my identity", st);
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
        const ids = await this._find_principal(kind, identifier);
        if (!ids) return;

        const sp = await this.fplus.ConfigDB
            .get_config(App.SparkplugAddress, ids.uuid);
        if (sp)
            ids.sparkplug = new Address(sp.group_id, sp.node_id);

        return ids;
    }

    async _find_principal (kind, identifier) {
        if (!kind)
            return this.whoami();

        const uuid = await this.resolve_principal([kind, identifier]);
        if (uuid == undefined) return;

        const [st, ids] = await this.fetch(`v2/principal/${uuid}`);
        if (st != 200) {
            this.debug.log("princ", "Failed to fetch principal %s: %s",
                uuid, st);
            return;
        }

        return ids;
    }

    /** Read the list of principal UUIDs.
     * @returns An Array of UUIDs.
     */
    async list_principals () {
        const [st, list] = await this.fetch("v2/principal");
        if (st != 200)
            this.throw("Can't fetch principal list", st);
        return list;
    }

    /** Read a specific identity.
     * @arg uuid The principal UUID.
     * @arg kind The identity type to look up.
     * @returns The principal's name.
     */
    async get_identity (uuid, kind) {
        const url = urljoin("v2", "principal", uuid, kind);
        const [st, name] = await this.fetch(url);
        if (st != 200)
            this.throw(`Can't fetch ${kind} identity for ${uuid}`, st);
        return name;
    }

    /** Add an identity for a principal.
     * This will silently succeed if there is an existing record which
     * matches, and fail with 409 if there is a conflict.
     *
     * @param uuid The principal UUID.
     * @param type The identity type.
     * @param name The identity name.
     */
    async add_identity (uuid, type, name) {
        const [st] = await this.fetch({
            method:     "PUT",
            url:        `v2/principal/${uuid}/${type}`,
            body:       name,
        });
        if (st != 204)
            this.throw(`Can't add ${type} identity ${name} for ${uuid}`, st);
    }

    add_principal (uuid, kerberos) {
        return this.add_identity(uuid, "kerberos", kerberos);
    }

    /** Delete an identity.
     * Returns true if we deleted an identity, false if the identity
     * already didn't exist.
     *
     * @param uuid The principal UUID.
     * @param type The type of identity to delete.
     */
    async delete_identity (uuid, type) {
        const [st] = await this.fetch({
            method:     "DELETE",
            url:        `v2/principal/${uuid}/${type}`
        });
        switch (st) {
            case 204:   return true;
            case 404:   return false;
            default:
                this.throw(`Can't delete ${type} identity for ${uuid}`, st);
        }
    }

    delete_principal (uuid) {
        return this.delete_identity(uuid, "kerberos");
    }

    /** Create a principal and set a Kerberos UPN.
     * This creates the principal in the ConfigDB and sets the identity
     * in the Auth service.
     *
     * @param klass The class UUID to use when creating the principal.
     * @param kerberos The Kerberos UPN to set.
     * @param name The _General Info_ name of the principal.
     */
    /* XXX There is a problem here: if we don't have permission to add
     * identities we create an object we can't clean up. */
    async create_principal (klass, kerberos, name) {
        const cdb = this.fplus.ConfigDB;
        const uuid = await cdb.create_object(klass);
        //try {
            await this.add_principal(uuid, kerberos);
        //}
        /* XXX This `deleted` field has moved to _Object
         * Registration_ but in general we are not likely to have
         * permission to PATCH that. */
        //catch (e) {
            //await cdb.put_config(App.Info, uuid, {
            //    name, deleted: true,
            //});
            //throw e;
        //}
        if (name)
            await cdb.put_config(App.Info, uuid, { name });
        return uuid;
    }

    /** List the current permission grants.
     * The returned list will be filtered and will only include grants
     * we have permission to edit.
     * @returns A list of grant UUIDs.
     */
    async list_grants () {
        const [st, uuids] = await this.fetch("v2/grant");
        if (st == 200) return uuids;
        this.throw("Can't list grants", st);
    }

    /** Fetch a single grant by UUID.
     * @param uuid A grant UUID.
     * @returns A grant object.
     */
    async get_grant (uuid) {
        const [st, grant] = await this.fetch(`v2/grant/${uuid}`);
        if (st == 200) return grant;
        this.throw(`Can't read grant ${uuid}`, st);
    }

    /** Fetch all grants.
     * Fetches all grants we have access to read. This makes a large
     * number of HTTP requests and should not be called frequently.
     * @returns A list of grant objects.
     */
    async get_all_grants () {
        const uuids = await this.list_grants();
        return Promise.all(uuids.map(u => this.get_grant(u)));
    }

    /** Search for a grant.
     * Finds all grants we have access to read which match the pattern
     * provided. Unspecified fields are wildcard.
     * @param pattern A grant object pattern.
     * @returns A list of grant UUIDs.
     */
    async find_grants (pattern) {
        const [st, json] = await this.fetch({
            method:     "POST",
            url:        "v2/grant/find",
            body:       pattern,
        });
        if (st == 200)
            return json;
        this.throw("Failed to search grants", st);
    }

    /** Create a new grant.
     * @param grant A grant object.
     * @returns the UUID of the new grant.
     */
    async add_grant (grant) {
        const [st, json] = await this.fetch({
            method:     "POST",
            url:        "v2/grant",
            body:       grant,
        });
        /* 200 indicates we have attempted to add a duplicate */
        if (st == 201 || st == 200) return json.uuid;
        this.throw("Failed to add grant", st);
    }

    /** Update a grant.
     * This replaces given grant with a new one.
     * @param uuid The UUID of the grant to replace.
     * @param grant The new grant object.
     */
    async set_grant (uuid, grant) {
        const [st] = await this.fetch({
            method:     "PUT",
            url:        `v2/grant/${uuid}`,
            body:       grant,
        });
        if (st == 204) return;
        this.throw(`Can't update grant ${uuid}`, st);
    }

    /** Delete a grant.
     * @param uuid The grant to delete.
     */
    async delete_grant (uuid) {
        const [st] = await this.fetch({
            method:     "DELETE",
            url:        `v2/grant/${uuid}`,
        });
        if (st == 204) return;
        this.throw(`Can't delete grant ${uuid}`, st);
    }

    /* These are deliberately not implemented; the grant format has
     * changed and old clients won't set the correct information. */
    _authv2 () { this.throw("Please update to support Auth v2"); }
    get_all_ace () { this._authv2(); }
    add_ace () { this._authv2(); }
    delete_ace () { this._authv2(); }

    /* XXX These could just forward to the ConfigDB? */
    add_to_group () { this._authv2(); }
    remove_from_group () { this._authv2(); }
}
