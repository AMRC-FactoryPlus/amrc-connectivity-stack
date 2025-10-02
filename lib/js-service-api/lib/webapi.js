/*
 * Copyright (c) University of Sheffield AMRC 2025.
 */

import http from "http";

import express from "express";
import createError from "http-errors";
import cors from "cors";

import { FplusHttpAuth }    from "./auth.js";

export class WebAPI {
    constructor (opts) {
        this.max_age = opts.max_age;
        this.ping_response = opts.ping;
        this.port = opts.http_port || 80;
        this.routes = opts.routes;
        this.log = opts.debug?.bound("http") ?? console.log;
        this.body_limit = opts.body_limit || "100kb";
        this.body_type = opts.body_type || 'json';

        this.auth = new FplusHttpAuth({
            ...opts,
            log: (req, res, ...args) => (req.log ?? this.log)(...args),
        });
        this.app = express();
    }

    async init () {
        let app = this.app;

        /* CORS */
        app.use(cors({ credentials: true, maxAge: 86400 }));

        /* Body decoders. These will only decode request bodies of the
         * appropriate content-type. */
        if (this.body_type === "raw") {
            // Parses raw binary bodies
            app.use(express.raw({ type: "*/*", limit: this.body_limit }));
        } else {
            app.use(express.json({ limit: this.body_limit, strict: false }));
            app.use(express.json({ limit: this.body_limit, strict: false, type: "application/merge-patch+json" }));
        }

        /* Logging */
        app.use((req, res, next) => {
            let buf = [];
            req.log = (...args) => buf.push(args);
            req.fail = (status, ...args) => {
                req.log(...args);
                throw { status };
            };

            req.log(">>> %s %s", req.method, req.url);
            res.on("finish", () => {
                req.log("<<< %s %s", res.statusCode, res.getHeader("Content-Type"));
                buf.forEach(a => this.log(...a));
            });
            next();
        });

        this.auth.setup(app);
        app.get("/ping", this.ping.bind(this));

        /* Set caching */
        if (this.max_age) {
            const cc = `max-age=${this.max_age}`;
            app.use((req, res, next) => {
                if (req.method == "GET")
                    res.header("Cache-Control", cc);
                next();
            });
        }

        /* Set up real routes */
        this.routes(app);

        /* Catch-all 404 */
        app.use((req, res, next) => next(createError(404)));

        /* Error handling */
        app.use((err, req, res, next) => {
            console.error(err);
            if (res.headersSent)
                return next(err);
            res.status(err.status || 500)
                .type("text/plain")
                .send(`Server error: ${err.message}`);
        });

        this.http = http.createServer(app);

        return this;
    }

    run () {
        this.log("Creating HTTP server on port %s", this.port);
        this.http.listen(this.port);
    }

    ping (req, res) {
        res.json(this.ping_response);
    }
}

