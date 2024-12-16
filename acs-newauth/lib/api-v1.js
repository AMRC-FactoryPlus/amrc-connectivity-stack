/*
 * ACS Auth service
 * HTTP API v1
 * Copyright 2024 University of Sheffield AMRC
 */


import express from "express";

import { UUIDs } from "@amrc-factoryplus/service-client";

export class APIv1 {
    constructor(opts) {
        this.fplus = opts.fplus;
        this.auth = opts.auth;

        this.log = this.fplus.debug.bound("apiv1");

        this.routes = express.Router();
        this.model = opts.model;

        this.setup_routes();
    }

    setup_routes() {
        let api = this.routes;

    }
}
