/*
 * ACS Files
 * A test harness: the v1 API over a temporary directory, with stub Auth
 * and ConfigDB clients
 * Copyright 2026 University of Sheffield
 */

import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import express from "express";

import { ServiceError, UUIDs } from "@amrc-factoryplus/service-client";

import { APIv1 } from "../lib/api-v1.js";
import { App, Class, Special } from "../lib/constants.js";

/* An Auth client that answers from a list of grants, as the Auth
 * service and the client's ACL check do between them. With `wild` a
 * grant on Special.Null matches every target. A grant on a class
 * matches the members of that class, and a grant on Special.Mine
 * matches the objects the principal owns, because the Auth service
 * expands both into one entry per object. `owned` maps a principal to
 * the objects it owns. */
export class StubAuth {
    constructor (opts) {
        this.grants = opts.grants;
        this.classes = opts.classes;
        this.owned = opts.owned ?? new Map();
        this.checks = [];
    }

    async check_acl (principal, permission, target, wild) {
        this.checks.push({ principal, permission, target, wild });
        return this.grants
            .filter(g => g.principal == principal && g.permission == permission)
            .some(g => g.target == target
                || (wild && g.target == Special.Null)
                || this.classes.get(g.target)?.has(target)
                || (g.target == UUIDs.Special.Mine
                    && this.owned.get(principal)?.has(target)));
    }
}

/* A ConfigDB client holding config entries and class members, which
 * records every config delete. `fail_delete` makes delete_config throw
 * that status once. */
export class StubConfigDB {
    constructor (opts) {
        this.classes = opts.classes;
        this.configs = new Map();
        this.deletes = [];
        this.fail_delete = null;
    }

    key (app, obj) { return `${app}/${obj}`; }

    async class_has_member (klass, obj) {
        return this.classes.get(klass)?.has(obj) ?? false;
    }

    async get_config (app, obj) {
        return this.configs.get(this.key(app, obj));
    }

    async put_config (app, obj, json) {
        this.configs.set(this.key(app, obj), JSON.parse(JSON.stringify(json)));
    }

    async delete_config (app, obj) {
        this.deletes.push({ app, obj });
        if (this.fail_delete) {
            const st = this.fail_delete;
            this.fail_delete = null;
            throw new ServiceError(UUIDs.Service.ConfigDB, "Delete failed", st);
        }
        const k = this.key(app, obj);
        if (!this.configs.has(k))
            throw new ServiceError(UUIDs.Service.ConfigDB,
                `Can't remove ${app} for ${obj}`, 404);
        this.configs.delete(k);
    }
}

/* Start the v1 API on a random port. Requests name their principal in
 * an `X-Test-Principal` header, standing in for the GSSAPI or token
 * auth that WebAPI does. `classes` maps a class UUID to its members,
 * and is shared by the two stubs. `owned` maps a principal to the
 * objects it owns in the ConfigDB. */
export async function start_files (opts) {
    const classes = opts.classes;
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "acs-files-test-"));
    const auth = new StubAuth({
        grants: opts.grants, classes, owned: opts.owned });
    const cdb = new StubConfigDB({ classes });
    const fplus = {
        Auth:       auth,
        ConfigDB:   cdb,
        debug:      { bound: () => () => {} },
    };

    const api = new APIv1({ fplus, uploadPath: dir });
    const app = express();
    app.use((req, res, next) => {
        req.auth = req.get("X-Test-Principal");
        next();
    });
    app.use("/v1/file", api.routes);
    app.use((err, req, res, next) => {
        res.status(err instanceof ServiceError ? 503 : 500)
            .type("text/plain")
            .send(`Server error: ${err.message}`);
    });

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}/v1/file`;

    const request = (method, uuid, principal, body) =>
        fetch(`${base}/${uuid}`, {
            method,
            body,
            headers: { "X-Test-Principal": principal },
        });

    const close = async () => {
        await new Promise(resolve => server.close(resolve));
        await fs.rm(dir, { recursive: true, force: true });
    };

    return { dir, auth, cdb, request, close, App, Class };
}
