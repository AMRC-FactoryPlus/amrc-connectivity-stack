/*
 * ACS Gateway Depot
 * HTTP API, version 1.
 * Copyright 2026 University of Sheffield AMRC
 */

import path     from "node:path";

import express  from "express";

import { Perm, Special }    from "./constants.js";
import { DepotError }       from "./errors.js";

const NOT_ALLOWED = "Your account does not have the Provision gateways permission. Ask a Factory+ administrator to grant it.";

function remote_ip (req) {
    const fwd = req.headers["x-forwarded-for"];
    const ip = (fwd ? fwd.split(",")[0].trim() : req.socket.remoteAddress) ?? "";
    /* Node reports IPv4 clients on a dual-stack socket as ::ffff:a.b.c.d. */
    return ip.replace(/^::ffff:/, "");
}

export class APIv1 {
    constructor (opts) {
        this.auth       = opts.fplus.Auth;
        this.depot      = opts.depot;
        this.payload    = opts.payload;
        this.stick      = opts.stick;

        this.log = opts.fplus.debug.bound("api-v1");
        this.routes = express.Router();
        this.setup_routes();
    }

    /* Most of what goes wrong here is something the person using the
     * Admin UI can put right, so errors carry a message for them. */
    wrap (fn) {
        return async (req, res, next) => {
            try {
                const rv = await fn.call(this, req, res);
                if (rv !== undefined) res.status(200).json(rv);
            }
            catch (e) {
                if (e instanceof DepotError)
                    return res.status(e.status).json({ error: e.message });
                next(e);
            }
        };
    }

    /* A route for people. They need Provision gateways. */
    person (fn) {
        return this.wrap(async (req, res) => {
            const ok = await this.auth.check_acl(
                req.auth, Perm.Provision, Special.Null, false);
            if (!ok) throw new DepotError(403, NOT_ALLOWED);
            return fn.call(this, req, res);
        });
    }

    setup_routes () {
        const api = this.routes;

        /* Called by gateways. These are public: a gateway has no
         * Factory+ credentials. It proves who it is with the secret it
         * made up when it first called. */
        api.post("/box/scout", this.wrap(this.scout));
        api.post("/box/:id/checkin", this.wrap(this.checkin));
        /* The Ubuntu installer's webhook. It may not say its body is
         * JSON, so read anything the JSON parser left as text. */
        api.post("/box/:id/progress/:token",
            express.text({ type: () => true, limit: "64kb" }),
            this.wrap(this.progress));
        /* The end of the installer's journal, as plain text, when the
         * install fails. */
        api.post("/box/:id/install-journal/:token",
            express.text({ type: () => true, limit: "256kb" }),
            this.wrap(this.install_journal));
        api.get("/payload/gateway-:sha.tar.gz", this.wrap(this.archive));
        api.get("/payload/k3s-:arch", this.wrap(this.k3s));
        /* The depot stick holds no settings and no secrets, and a
         * browser downloads it without Factory+ credentials. */
        api.get("/payload/:name.iso", this.wrap(this.stick_file));

        api.get("/gateway", this.person(this.gateway_list));
        api.get("/settings", this.person(this.settings));
        api.get("/cluster", this.person(this.cluster_list));
        api.get("/stick", this.person(this.stick_status));
        api.post("/gateway/:id/approve", this.person(this.approve));
        api.post("/gateway/:id/onboard", this.person(this.onboard));
        api.delete("/gateway/:id", this.person(this.forget));
    }

    scout (req) {
        return this.depot.scout(req.body ?? {}, remote_ip(req));
    }

    checkin (req) {
        return this.depot.checkin(req.params.id, req.body ?? {}, remote_ip(req));
    }

    progress (req, res) {
        let event = req.body;
        if (typeof event == "string") {
            try { event = JSON.parse(event); }
            catch { throw new DepotError(400, "A progress report must be JSON."); }
        }
        this.depot.progress(req.params.id, req.params.token, event ?? {});
        res.status(204).end();
    }

    install_journal (req, res) {
        const text = typeof req.body == "string" ? req.body : "";
        this.depot.install_journal(req.params.id, req.params.token, text);
        res.status(204).end();
    }

    archive (req, res) {
        res.type("application/gzip")
            .sendFile(this.payload.archive_path(req.params.sha));
    }

    k3s (req, res) {
        res.type("application/octet-stream")
            .sendFile(this.payload.k3s_for(req.params.arch).file);
    }

    stick_file (req, res) {
        const file = this.stick.path_for(`${req.params.name}.iso`);
        res.download(file, path.basename(file));
    }

    stick_status () {
        return this.stick.status();
    }

    gateway_list () {
        return this.depot.list();
    }

    settings () {
        return this.depot.settings();
    }

    cluster_list () {
        return this.depot.list_clusters();
    }

    approve (req) {
        return this.depot.approve(req.params.id, req.body ?? {}, req.auth);
    }

    onboard (req) {
        return this.depot.onboard(req.params.id, req.body ?? {}, req.auth);
    }

    async forget (req, res) {
        await this.depot.forget(req.params.id, req.auth);
        res.status(204).end();
    }
}
