/*
 * ACS Auth component
 * Template caching / metadata
 * Copyright 2024 University of Sheffield AMRC
 */

import util from "util";

import * as rx from "rxjs";

import * as rxx from "@amrc-factoryplus/rx-util";

import { App, Class } from "./uuids.js";

function is_scalar (v) { return v == null || typeof v != "object"; }

class Environment {
    constructor (templates, permissions) {
        this.permissions = permissions;
        this.templates = templates;

        this.metadata = new Map();
        for (const [name, definition] of this.templates.entries()) {
            this.metadata.set(name, new Template(this, definition));
        }
    }
}

class Template {
    constructor (env, [args, ...definition]) {
        this.env = env;

        this.calls = new Set();
        this.lookups = new Set();
        this.perms = new Set();
        this.errors = new Set();

        definition.forEach(e => this.expr(e));
    }

    expr (expr) {
        if (is_scalar(expr))
            return;

        if (!Array.isArray(expr)) {
            Object.values(expr).forEach(e => this.expr(e));
            return;
        }

        const [name, ...args] = expr;
        if (name == "lookup") {
            const [svc, url, item] = args;
            if (!is_scalar(svc) || !is_scalar(url)) {
                this.errors.add(util.format("Inappropriate args for lookup: %O", args));
                return;
            }
            this.lookups.add(`${svc}/${url}`);
            this.expr(item);
        }
        else {
            if (this.env.permissions.has(name))
                this.perms.add(name);
            if (this.env.templates.has(name))
                this.calls.add(name);
            args.forEach(e => this.expr(e));
        }
    }
}

export class TemplateEngine {
    constructor (opts) {
        this.fplus = opts.fplus;

        this.log = opts.fplus.debug.bound("template");

        const cdb = this.fplus.ConfigDB;
        const members = k => rxx.rx(
            cdb.watch_members(k),
            rxx.shareLatest());

        this.permissions = members(Class.BasePerm);
        this.environment = this._build_env();
    }

    run () {
        this.environment.subscribe(e => 
            this.log("New template env: %O", e));
    }

    _build_env () {
        return rxx.rx(
            /* XXX This is not limited to the Template class */
            this.fplus.ConfigDB.search_app(App.Template),
            rx.withLatestFrom(this.permissions),
            rx.map(([ts, ps]) => new Environment(ts, ps)));
    }
}
