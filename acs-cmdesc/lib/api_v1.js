/*
 * Factory+ / AMRC Connectivity Stack (ACS) Command Escalation component
 * v1 HTTP API
 * Copyright 2022 AMRC
 */

import express from "express";
import typeis from "type-is";

import {Address} from "@amrc-factoryplus/utilities";

export default class ApiV1 {
    constructor(opts) {
        this.cmdesc = opts.cmdesc;

        this.routes = express.Router();
    }

    async init() {
        this.setup_routes();
        return this;
    }

    setup_routes() {
        const api = this.routes;

        api.post("/address/:group/:node", this.by_address.bind(this));
        api.post("/address/:group/:node/:device", this.by_address.bind(this));
    }

    async by_address(req, res) {
        if (!typeis(req, "application/json"))
            return res.status(415).end();

        const to = new Address(
            req.params.group, req.params.node, req.params.device);

        const st = await this.cmdesc.execute_command(
            req.auth, to, req.body);
        res.status(st).end();
    }
}
