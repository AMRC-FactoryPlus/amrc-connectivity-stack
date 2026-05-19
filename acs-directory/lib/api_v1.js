/*
 * Factory+ / AMRC Connectivity Stack (ACS) Directory component
 * Copyright 2021 AMRC
 */

import url from "node:url";
import express from "express";
import OpenApiValidator from "express-openapi-validator";
import {Perm, Special} from "./uuids.js";

function fqdn_split (fqdn) {
    return fqdn.match(/([^.]*)\.(.*)/).slice(1);
}

/* Express 4 does not forward rejected promises from async route
 * handlers to the error middleware: they surface as unhandled rejections
 * and (with the current Node default) terminate the process. Wrap every
 * async handler so a pg error (e.g. a malformed UUID in :uuid or :type)
 * becomes a 5xx response instead of crashing the pod. */
function wrap (handler) {
    return (req, res, next) => Promise.resolve(handler(req, res, next))
        .catch(next);
}

/* Grr. Specifying security by changing URL scheme is just stupid. */
const _tlsmap = [
    ["http", "https"],
    ["mqtt", "mqtts"],
    ["ws", "wss"],
];
const schemes = new Map(_tlsmap.map(v => [v[0], v]));
const with_tls = new Set(_tlsmap.map(v => v[1]));

export default class API {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.model = opts.model;
        this.internal = fqdn_split(opts.internal_hostname)[1];

        this.routes = express.Router();
    }

    async init() {
        this.setup_routes();
        return this;
    }

    setup_routes() {
        let api = this.routes;

        /* Validate against the spec */
        //const spec = url.fileURLToPath(new URL("../api/openapi.yaml", import.meta.url));
        //console.log(`Loading OpenAPI spec from ${spec}...`);
        //api.use(OpenApiValidator.middleware({
        //    apiSpec: spec,
        //}));

        /* bind + wrap: every async handler must go through wrap() so a
         * thrown error reaches the express error middleware rather than
         * propagating out as an unhandled rejection. */
        const h = (method, ...args) => wrap(this[method].bind(this, ...args));

        api.get("/search", h("search"));

        api.get("/address", h("addr_groups"));
        api.get("/address/:group", h("addr_group"));
        api.get("/address/:group/:node", h("addr_node"));
        api.get("/address/:group/:node/:device", h("addr_device"));

        api.get("/device", h("devices"));
        api.get("/device/:device", h("device"));
        api.get("/device/:device/history", h("history"));

        api.get("/schema", h("schemas"));
        api.get("/schema/:schema/devices", h("schema_devices"));

        api.get("/service", h("services"));
        api.get("/service/:service", h("service_providers"));

        api.route("/service/:service/advertisment")
            .get((req,res) => res.status(403))
            .put((req,res) => res.status(403));
        /* Delete unimplemented for now. */
        //    .delete(this.service_advert_del.bind(this));

        api.route("/service/:service/advertisment/:owner")
            .get((req,res) => res.status(403))
            .put((req,res) => res.status(403));
        /* Delete unimplemented for now. */
        //    .delete(this.service_advert_del.bind(this));

        /* XXX These are ALPHA.
         *  - It may be better for the list endpoints to return just a
         *  list of UUIDs rather than the full info.
         *  - We need to index the Links too, or this is a bit useless.
         */
        api.get("/alert", h("alert_list", false));
        api.get("/alert/active", h("alert_list", true));
        api.get("/alert/type/:type", h("alert_list", false));
        api.get("/alert/type/:type/active", h("alert_list", true));
        api.get("/alert/:uuid", h("alert_single"));

        const ll = h("link_list");
        api.get("/link", ll);
        api.get("/link/device/:device", ll);
        api.get("/link/source/:source", ll);
        api.get("/link/relation/:relation", ll);
        api.get("/link/target/:target", ll);
        api.get("/link/:uuid", h("link_single"));
    }

    async search(req, res) {
        let list = await this.model.search(req.query);
        res.status(200).json(list);
    }

    async devices(req, res) {
        const list = await this.model.devices()
        res.status(200).json(list);
    }

    async device(req, res) {
        const uuid = req.params.device;

        let info = await this.model.device_info_by_uuid(uuid);
        if (info == null) {
            res.status(404).end();
        } else {
            res.status(200).json(info);
        }
    }

    async history(req, res) {
        const device = req.params.device;
        const q = req.query;

        let sessions = await this.model.sessions({
            device: device,
            start: (q.start ? new Date(q.start) : null),
            finish: (q.finish ? new Date(q.finish) : null),
        });
        if (sessions.length == 0) {
            res.status(404).end();
        } else {
            res.status(200).json(sessions);
        }
    }

    async schemas(req, res) {
        const list = await this.model.schemas();
        res.status(200).json(list);
    }

    async schema_devices(req, res) {
        const uuid = req.params.schema;
        const devs = await this.model.schema_devices(uuid);
        res.status(200).json(devs);
    }

    async services(req, res) {
        const list = await this.model.services();
        res.status(200).json(list);
    }

    async service_providers(req, res) {
        const uuid = req.params.service;
        const devs = await this.model.service_providers(uuid);

        const fwd_fqdn = req.get("X-Forwarded-Host");
        if (fwd_fqdn) {
            const [, fwd_domain] = fqdn_split(fwd_fqdn);

            const fwd_proto = req.get("X-Forwarded-Proto");
            const scheme_ix = with_tls.has(fwd_proto) ? 1 : 0;

            for (const dev of devs) {
                const url = new URL(dev.url);
                const [host, domain] = fqdn_split(url.hostname);
                if (domain != this.internal)
                    continue;

                url.hostname = `${host}.${fwd_domain}`;
                const protos = schemes.get(url.protocol.slice(0,-1));
                if (protos)
                    url.protocol = protos[scheme_ix]

                console.log("Rewriting %s to %s", dev.url, url);
                dev.url = url.toString();
            }
        }

        res.status(200).json(devs);
    }

    async addr_groups(req, res) {
        const list = await this.model.addr_groups();
        res.status(200).json({
            address: "",
            children: list,
        });
    }

    async addr_group(req, res) {
        const {group} = req.params;
        const list = await this.model.addr_nodes(group);

        if (list.length == 0)
            return res.status(404).send();

        res.status(200).json({
            address: `${group}`,
            children: list,
        });
    }

    async addr_node(req, res) {
        const {group, node} = req.params;

        const {uuid, list} = await this.model.addr_node(group, node);

        if (uuid == null)
            return res.status(404).send();

        const rv = {
            address: `${group}/${node}`,
            uuid: uuid,
        };
        if (list.length > 0)
            rv.children = list;

        res.status(200).json(rv);
    }

    async addr_device(req, res) {
        const {group, node, device} = req.params;

        const uuid = await this.model.addr_device(group, node, device);
        if (uuid == null)
            return res.status(404).send();

        res.status(200).json({
            address: `${group}/${node}/${device}`,
            uuid: uuid,
        });
    }

    acl (principal) {
        /* `principal` is whatever the auth middleware put on req.auth -
         * a Kerberos UPN for Basic / Negotiate / opaque-token callers,
         * a principal UUID for JWT callers. Pick the identity type from
         * the shape: hard-coding "kerberos" 404s on a UUID input and
         * the resulting NotifyError crashes the webapi pod. */
        const type = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
            .test(principal) ? "uuid" : "kerberos";
        return this.fplus.Auth.fetch_auth_acl(type, principal);
    }

    async alert_list (active_only, req, res) {
        const {type} = req.params;

        const acl = await this.acl(req.auth);
        if (!acl)
            return res.status(503).end();

        const perm = p => acl.filter(a => a.permission == p)
            .map(a => a.target);
        const types = perm(Perm.Read_Alert_Type);
        const devices = perm(Perm.Read_Device_Alerts);
        const ifwild = l => l.includes(Special.Null) ? null : l;
        
        const alerts = await this.model.alert_list({
            type, active_only,
            types:      ifwild(types),
            devices:    ifwild(devices),
        });
        return res.status(200).json(alerts);
    }

    async alert_single (req, res) {
        const {uuid} = req.params;
        const auth = this.fplus.Auth;

        const alrt = await this.model.alert_by_uuid(uuid);

        /* XXX timing attack */
        if (alrt == null) return res.status(404).end();

        const ck = (p, o) => auth.check_acl(req.auth, p, o, true);
        const ok = await ck(Perm.Read_Alert_Type, alrt.type)
            || await ck(Perm.Read_Device_Alerts, alrt.device);

        /* We unhelpfully return 404 here to prevent unauthorised
         * clients from discovering which alerts exist. This is
         * consistent with removing them from the lists. */
        if (!ok) return res.status(404).end();
        return res.status(200).json(alrt);
    }

    async link_list (req, res) {
        const { params } = req;

        const acl = await this.acl(req.auth);
        if (!acl) return res.status(503).end();

        const mod = this.model;
        const links = await (
            "device" in params      ? mod.link_list_by_device(params.device)
            : "source" in params    ? mod.link_list_by_source(params.source)
            : "relation" in params  ? mod.link_list_by_relation(params.relation)
            : "target" in params    ? mod.link_list_by_target(params.target)
            : mod.link_list());

        const perm = p => {
            const l = new Set(
                acl.filter(a => a.permission == p)
                    .map(a => a.target));
            const w = l.has(Special.Null);
            return o => w || l.has(o);
        };
        const rel_ok = perm(Perm.Read_Link_Relation);
        const dev_ok = perm(Perm.Read_Device_Links);
        const rv = links.filter(l => rel_ok(l.relation) || dev_ok(l.device));

        return res.status(200).json(rv);
    }

    async link_single (req, res) {
        const { uuid } = req.params;
        const auth = this.fplus.Auth;

        const link = await this.model.link_by_uuid(uuid);

        /* XXX timing attack (matches alert_single) */
        if (link == null) return res.status(404).end();

        const ck = (p, o) => auth.check_acl(req.auth, p, o, true);
        const ok = await ck(Perm.Read_Link_Relation, link.relation)
            || await ck(Perm.Read_Device_Links, link.device);

        if (!ok) return res.status(404).end();
        return res.status(200).json(link);
    }
}
