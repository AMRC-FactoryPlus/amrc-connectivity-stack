/*
 * Factory+ / AMRC Connectivity Stack (ACS) Command Escalation component
 * MQTT client
 * Copyright 2022 AMRC
 */

import * as rx              from "rxjs";

import {Address, UUIDs,}    from "@amrc-factoryplus/service-client";
import * as rxx             from "@amrc-factoryplus/rx-util";

import { MqttCli }          from "./mqttcli.js";

const CCL_Perms = "9584ee09-a35a-4278-bc13-21a8be1f007c";
const CCL_Template = "60e99f28-67fe-4344-a6ab-b1edb8b8e810";

/* A caller who signed in with a Keycloak JWT reaches us as their
 * principal UUID, not as a Kerberos UPN. */
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/* Thrown when we could not read a caller's ACL from the Auth service.
 * The request is refused, but the failure is ours, not the caller's. */
export class AclUnavailable extends Error {
    constructor (message, opts) {
        super(message, opts);
        this.name = "AclUnavailable";
    }
}

export default class CmdEscD {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.root = this.fplus.Auth.root_principal;
        this.log = this.fplus.debug.log.bind(this.fplus.debug);

        this.mqtt = new MqttCli({
            fplus:  this.fplus,
            cmdesc: this,
        });

        const cdb = this.fplus.ConfigDB;
        this.addresses = rxx.rx(
            cdb.search_app(UUIDs.App.SparkplugAddress),
            rx.map(as => as.map(a => 
                new Address(a.group_id, a.node_id, a.device_id))),
            rx.shareReplay(1));
        this.templates = rxx.rx(
            cdb.search_app(CCL_Template),
            rx.shareReplay(1));
    }

    run () { this.mqtt.run(); }

    decode_principal (princ, addrs) {
        if (typeof princ == "string")
            return [UUID_RX.test(princ) ? "uuid" : "kerberos", princ];
        if (!(princ instanceof Address))
            return this.log("cmdesc", "Unrecognised principal %o", princ);

        if (princ.isDevice()) {
            this.log("cmdesc", "Cannot authorise request from a Device");
            return;
        }

        const uuids = addrs.toSeq()
            .filter(a => a.equals(princ))
            .keySeq();
        
        if (uuids.isEmpty())
            return this.log("cmdesc", "No UUID found for address %s", princ);
        if (uuids.count() > 1)
            return this.log("cmdesc", "More than one UUID for address %s", princ);

        return ["uuid", uuids.first()];
    }

    /* Returns the commands `princ` may send. Throws AclUnavailable if
     * the Auth service could not give us an answer. A principal Auth
     * does not know (404) has an empty ACL. */
    async expand_acl(princ) {
        const addrs = await rx.firstValueFrom(this.addresses);
        const tmpls = await rx.firstValueFrom(this.templates);

        const query = this.decode_principal(princ, addrs);
        if (!query) return [];

        let acl;
        try {
            acl = await this.fplus.Auth.fetch_auth_acl(...query);
        }
        catch (e) {
            if (e?.status == 404) {
                this.log("acl", "Auth has no ACL for %s", princ);
                return [];
            }
            throw new AclUnavailable(
                `Can't read ACL for ${princ}: ${e?.message ?? e}`,
                { cause: e });
        }

        const res_targ = t => t == UUIDs.Null ? true : addrs.get(t);

        return acl.flatMap(ace => {
            const tags = tmpls.get(ace.permission);
            const address = res_targ(ace.target);
            return tags && address ? [{tags, address}] : [];
        });
    }

    /* The sender identity we put in the body of the CMD. */
    sender (from) {
        if (from instanceof Address)
            return `sparkplug:${from}`;
        return UUID_RX.test(from) ? `uuid:${from}` : `kerberos:${from}`;
    }

    /* Potential return values:
     * 200: OK
     * 403: Forbidden
     * 404: Metric does not exist
     * 409: Wrong type / metric otherwise can't be set
     * 503: Device offline / not responding, or we have no connection
     *      to the MQTT broker
     *
     * from can be an Address, a Kerberos principal string, or a
     * principal UUID string (a caller who signed in with a JWT).
     * to must be an Address.
     * cmd is { name, type?, value }
     */
    async execute_command(from, to, cmd) {
        const log = stat => {
            this.log("cmdesc", `${stat}: ${from} -> ${to}[${cmd.name} = ${cmd.value}]`);
            return stat;
        };

        /* We can only give root rights if a type is explicitly
         * supplied. Otherwise we don't know what type to send. */
        const is_root =
            this.root != undefined &&
            typeof (from) == "string" &&
            "type" in cmd &&
            from == this.root;

        if (is_root) {
            this.log("acl", `Granting root rights to ${from}`);
        }
        else {
            let acl;
            try {
                acl = await this.expand_acl(from);
            }
            catch (e) {
                /* Never let one caller's ACL take the process down. */
                this.log("acl", "ACL check failed for %s: %s",
                    from, e?.message ?? e);
                return log(503);
            }
            this.log("acl", "ACL for %s: %o", from, acl);

            const type_ok = cmd.type == undefined
                ? t => true
                : t => t == undefined || t == cmd.type;
            const tag = acl
                .filter(ace => ace.address === true ||
                    ace.address.matches(to))
                .flatMap(ace => ace.tags)
                ?.find(t => t.name == cmd.name &&
                    type_ok(t.type))
            if (!tag) return log(403);

            if (cmd.type == undefined) {
                cmd.type = tag.type ?? "Boolean";
            } else if (cmd.type != tag.type) {
                return log(409);
            }
        }

        const sent = await this.mqtt.publish({
            address:    to,
            type:       "CMD",
            metrics:    [cmd],
            from:       this.sender(from),
        });
        return log(sent ? 200 : 503);
    }
}
