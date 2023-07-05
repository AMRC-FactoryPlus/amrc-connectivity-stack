/*
 * Factory+ / AMRC Connectivity Stack (ACS) Authorisation component
 * Password authentication
 * Copyright 2021 AMRC
 */

import express from "express";

export default class AuthN {
    constructor(opts) {
        this.routes = express.Router();
    }

    async init() {
        this.setup_routes();

        return this;
    }

    setup_routes() {
        let api = this.routes;

        /* This service is now minimal and only exists for back-compat.
         */
        api.post("/authenticate", this.authenticate.bind(this));
    }

    async authenticate(req, res) {
        /* If we get this far we've passed Basic auth */
        res.set("X-Auth-Principal", req.auth);
        return res.json({ok: true});
    }

}
