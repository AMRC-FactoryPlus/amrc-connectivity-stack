/*
 * ACS Auth service
 * HTTP API v2
 * Copyright 2025 University of Sheffield AMRC
 */

import express from "express";
import * as imm from "immutable";
import * as rx from "rxjs";

import { UUIDs } from "@amrc-factoryplus/service-client";

import Model from "./model.js";
import {Perm} from "./uuids.js";
import { booleans, valid_krb, valid_uuid } from "./validate.js";

function fail (status) {
    throw { status };
}

export class APIv2 {
    constructor(opts) {
        this.model = opts.model;
        this.data = opts.data;

        this.log = opts.debug.bound("apiv2");

        this.routes = this.setup_routes();
    }

    setup_routes() {
        let api = express.Router();

        api.get("/acl/:principal", this.get_acl.bind(this));

        return api;
    }

    async fetch_acl (principal) {
        const acl = rx.firstValueFrom(
            this.data.acl_for(principal));
        this.log("Fetched ACL for %s: %o", principal, acl);
        return acl;
    }

    async check_acl (krb, perm, targ, wild) {
        const princ = await this.model.principal_find_by_krb(krb);
        if (!princ) fail(403);

        const acl = await this.fetch_acl(princ);
        throw "incomplete";
    }

    async get_acl (req, res) {
        const { principal } = req.params;
        if (!valid_uuid(principal)) fail(410);

        const acl = await this.fetch_acl(principal);
        if (!acl) fail(404);

        const permitted = await this.model.principal_find_by_krb(req.auth)
            .then(r => this.fetch_acl(r))
            .then(acl => imm.Seq(acl)
                .filter(e => e.permission == Perm.Read_ACL)
                .map(e => e.target)
                .toSet());
        this.log("Permitted Read_ACL for %s: %o", req.auth, permitted.toJS());

        const rv = permitted.has(UUIDs.Special.Null) ? acl
            : acl.filter(e => permitted.has(e.permission));
        this.log("Returning ACL %o", rv);

        return res.status(200).json(rv);
    }
}
