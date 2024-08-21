/*
 * Factory+ / AMRC Connectivity Stack (ACS) Command Escalation component
 * MQTT client
 * Copyright 2022 AMRC
 */

import {Address, Debug, UUIDs,} from "@amrc-factoryplus/utilities";

const CCL_Perms = "9584ee09-a35a-4278-bc13-21a8be1f007c";
const CCL_Template = "60e99f28-67fe-4344-a6ab-b1edb8b8e810";

export default class CmdEscD {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.root = this.fplus.Auth.root_principal;
        this.log = this.fplus.debug.log.bind(this.fplus.debug);
    }

    async init() {
        return this;
    }

    set_mqtt(m) {
        this.mqtt = m;
    }

    async find_principal_for_address(from) {
        if (from.isDevice()) {
            this.log("cmdesc", "Cannot authorise request from a Device");
            return;
        }

        const res = await this.fplus.fetch({
            service: UUIDs.Service.Registry,
            url: `/v1/app/${UUIDs.App.SparkplugAddress}/search`,
            query: {
                group_id: JSON.stringify(from.group),
                node_id: JSON.stringify(from.node),
            },
        });
        if (!res.ok) {
            this.log("cmdesc", `Failed to look up address ${from}: ${res.status}`);
            return;
        }
        const json = await res.json();

        switch (json.length) {
            case 0:
                this.log("cmdesc", `No UUID found for address ${from}`);
                return;
            case 1:
                break;
            default:
                this.log("cmdesc", `More than one UUID found for address ${from}`);
                return;
        }

        this.log("cmdesc", `Request from ${from} = ${json[0]}`);
        return json[0];
    }

    async fetch_acl(princ, by_uuid) {
        const res = await this.fplus.fetch({
            service: UUIDs.Service.Authentication,
            url: "/authz/acl",
            query: {
                principal: princ,
                permission: CCL_Perms,
                "by-uuid": !!by_uuid,
            },
        });
        if (!res.ok) {
            this.log("acl", `Can't get ACL for ${princ}: ${res.status}`);
            return [];
        }

        return await res.json();
    }

    async expand_acl(princ) {
        let acl;
        if (princ instanceof Address) {
            const uuid = await this.find_principal_for_address(princ);
            if (!uuid) return [];
            acl = await this.fetch_acl(uuid, true);
        } else {
            acl = await this.fetch_acl(princ, false);
        }

        /* Fetch the CDB entries we need. Don't fetch any entry more
         * than once, the HTTP caching logic can't return a cached
         * result for a request still in flight. */
        const perms = new Map(acl.map(a => [a.permission, null]));
        const targs = new Map(
            /* We don't need to look up the wildcard address. */
            acl.filter(a => a.target != UUIDs.Null)
                .map(a => [a.target, null]));

        await Promise.all([
            ...[...perms.keys()].map(perm =>
                this.fplus.fetch_configdb(CCL_Template, perm)
                    .then(tmpl => perms.set(perm, tmpl))),

            ...[...targs.keys()].map(targ =>
                this.fplus.fetch_configdb(UUIDs.App.SparkplugAddress, targ)
                    .then(a => a
                        ? new Address(a.group_id, a.node_id, a.device_id)
                        : null)
                    .then(addr => targs.set(targ, addr))),
        ]);

        const res_targ = t => t == UUIDs.Null ? true : targs.get(t);

        return acl.flatMap(ace => {
            const tags = perms.get(ace.permission);
            const address = res_targ(ace.target);
            return tags && address ? [{tags, address}] : [];
        });
    }

    /* Potential return values:
     * 200: OK
     * 403: Forbidden
     * 404: Metric does not exist
     * 409: Wrong type / metric otherwise can't be set
     * 503: Device offline / not responding
     *
     * from can be an Address or a Kerberos principal string.
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
            const acl = await this.expand_acl(from);
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

        this.mqtt.publish({
            address:    to,
            type:       "CMD",
            metrics:    [cmd],
            from:       from instanceof Address 
                ? `sparkplug:${from}`
                : `kerberos:${from}`,
        });
        return log(200);
    }
}
