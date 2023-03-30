/*
 * Factory+ / AMRC Connectivity Stack (ACS) Directory component
 * Copyright 2021 AMRC
 */

import url from "node:url";
import express from "express";
import OpenApiValidator from "express-openapi-validator";
import {Perm} from "./uuids.js";

export default class API {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.model = opts.model;

        this.routes = express.Router();
    }

    async init() {
        this.setup_routes();
        return this;
    }

    setup_routes() {
        let api = this.routes;

        /* Validate against the spec */
        const spec = url.fileURLToPath(new URL("../api/openapi.yaml", import.meta.url));
        console.log(`Loading OpenAPI spec from ${spec}...`);
        api.use(OpenApiValidator.middleware({
            apiSpec: spec,
        }));

        api.get("/search", this.search.bind(this));

        api.get("/address", this.addr_groups.bind(this));
        api.get("/address/:group", this.addr_group.bind(this));
        api.get("/address/:group/:node", this.addr_node.bind(this));
        api.get("/address/:group/:node/:device", this.addr_device.bind(this));

        api.get("/device", this.devices.bind(this));
        api.get("/device/:device", this.device.bind(this));
        api.get("/device/:device/history", this.history.bind(this));

        api.get("/schema", this.schemas.bind(this));
        api.get("/schema/:schema/devices", this.schema_devices.bind(this));

        api.get("/service", this.services.bind(this));
        api.get("/service/:service", this.service_providers.bind(this));

        api.route("/service/:service/advertisment")
            .get(this.service_advert_get.bind(this))
            .put(this.service_advert_put.bind(this));
        /* Delete unimplemented for now. */
        //    .delete(this.service_advert_del.bind(this));

        api.route("/service/:service/advertisment/:owner")
            .get(this.service_advert_get.bind(this))
            .put(this.service_advert_put.bind(this));
        /* Delete unimplemented for now. */
        //    .delete(this.service_advert_del.bind(this));
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
        res.status(200).json(devs);
    }

    async service_advert_get(req, res) {
        const {service} = req.params;

        const requester = await this.fplus.resolve_principal(
            {kerberos: req.auth});
        const owner = req.params.owner ?? requester;

        const ok = requester == owner
            || await this.fplus.check_acl(
                req.auth, Perm.Manage_Service, owner, true);
        if (!ok)
            return res.status(403).end();

        const advert = await this.model.service_advert(service, owner);

        if (advert == null)
            return res.status(404).end();
        return res.status(200).json(advert);
    }

    async service_advert_put(req, res) {
        const {service} = req.params;
        const {device, url} = req.body;

        /* A bootstrap request comes from root_principal and has owner
         * specified. It is important in this case that we do no network
         * lookups, as we haven't got service URLs yet. */

        const setid = "owner" in req.params;
        const owner = req.params.owner
            ?? await this.fplus.resolve_principal({kerberos: req.auth});
        if (owner == null) return res.status(400).end();

        const ckown = (p, t) => {
            console.log(`Checking ACL: ${owner}, ${p}, ${t}`);
            return this.fplus.check_acl({uuid: owner}, p, t, true);
        };
        const ckreq = (p, t) => {
            console.log(`Checking ACL: ${req.auth}, ${p}, ${t}`);
            return this.fplus.check_acl({kerberos: req.auth}, p, t, true);
        };

        const ok =
            (!setid || await ckreq(Perm.Manage_Service, owner))
            && (await ckown(Perm.Advertise_Service, service)
                || await ckreq(Perm.Override_Service, service));
        if (!ok) return res.status(403).end();

        const st = await this.model.record_service({
            service, owner, device, url
        });

        if (st == null)
            return res.status(400).end();
        return res.status(204).end();
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
}
