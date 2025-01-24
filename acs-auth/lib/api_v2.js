/*
 * ACS Auth service
 * HTTP API v2
 * Copyright 2025 University of Sheffield AMRC
 */

import express from "express";
import * as rx from "rxjs";

import { UUIDs } from "@amrc-factoryplus/service-client";

import Model from "./model.js";
import {Perm} from "./uuids.js";
import { booleans, valid_krb, valid_uuid } from "./validate.js";

export class APIv2 {
    constructor(opts) {
        this.debug  = opts.debug;
        this.model = opts.model;
        this.data = opts.data;

        this.routes = this.setup_routes();
    }

    setup_routes() {
        let api = express.Router();

        api.get("/acl/:principal", this.get_acl.bind(this));

        return api;
    }

    async get_acl (req, res) {
        /* XXX No auth for now */
        const { principal } = req.params;

        const acl = await rx.firstValueFrom(
            this.data.acl_for(principal));

        if (!acl) return res.status(404).end();
        return res.status(200).json(acl);
    }
}
