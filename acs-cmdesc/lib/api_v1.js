/*
 * Factory+ / AMRC Connectivity Stack (ACS) Command Escalation component
 * v1 HTTP API
 * Copyright 2022 AMRC
 */

import express from "express";
import typeis from "type-is";

import {Address} from "@amrc-factoryplus/service-client";

export default class ApiV1 {
    constructor(opts) {
        this.cmdesc = opts.cmdesc;

        this.routes = this.build_routes();
    }

    async init() {
        return this;
    }

    build_routes() {
        const api = express.Router();

        api.post("/address/:group/:node", this.by_address.bind(this));
        api.post("/address/:group/:node/:device", this.by_address.bind(this));

        return api;
    }

    async by_address(req, res) {
        if (!typeis(req, "application/json"))
            return res.status(415).end();

        const to = new Address(
            req.params.group, req.params.node, req.params.device);

        /* This router is express 4, which does not catch a rejected
         * handler. An unhandled rejection would stop the process, so
         * any failure here must end as a response. */
        let st;
        try {
            st = await this.cmdesc.execute_command(req.auth, to, req.body);
        }
        catch (e) {
            console.log("Command request failed: %s", e?.stack ?? e);
            st = 503;
        }
        res.status(st).end();
    }
}
