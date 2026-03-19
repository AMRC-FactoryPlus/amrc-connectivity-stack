/*
 * ACS MES Collation
 * REST API v1
 */

import express from "express";

import { Perm } from "./constants.js";

export class APIv1 {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.auth = opts.auth;
        this.model = opts.model;
        this.log = this.fplus.debug.bound("apiv1");

        this.routes = express.Router();
        this.setup_routes();
    }

    setup_routes () {
        let api = this.routes;

        api.get("/health", this.health.bind(this));

        /* XXX Add routes here */
    }

    async health (req, res) {
        res.status(200).json({ status: "ok" });
    }
}
