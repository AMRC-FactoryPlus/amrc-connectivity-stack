/*
 * ACS Auth component
 * Template caching / metadata
 * Copyright 2024 University of Sheffield AMRC
 */

import util from "util";

import * as imm from "immutable";
import * as rx from "rxjs";

import * as rxx from "@amrc-factoryplus/rx-util";

import { App, Class } from "./uuids.js";

function is_scalar (v) { return v == null || typeof v != "object"; }

//const Requirements = imm.Record({
//    grants:     imm.Set(),
//    lookups:    imm.Set(),
//});
//const requirements = analysis.entrySeq()
//    .flatMap(([f, a]) => a.perms.map(p => [p, f]))
//    .reduce((r, [p, f]) => r.set(p, r.get(p, imm.Set()).add(f)), imm.Map())
//    .map((fs, p) => Requirements({
//        grants:     fs.flatMap(f => analysis.get(f).calls.add(f)).add(p),
//        lookups:    fs.flatMap(f => analysis.get(f).lookups),
//    }));

const TError = imm.Record({
    type:   "",
    detail: null,
});
const Environment = imm.Record({
    permissions:    imm.Set(),
    templates:      imm.Map(),
});
/* This is the final analysis in frozen form */
const Analysis = imm.Record({
    definition: null,
    lookups:    imm.Set(),
    perms:      imm.Set(),
    errors:     imm.Set(),
});

const showJS = e => util.inspect(e.toJS(), { depth: null })

/** Analyze all templates against the given permission list.
 * Returns an immutable Map from UUID to Analysis giving a full-depth
 * analysis of all the templates in terms of the templates, base
 * permissions and service lookups required to evaluate. */
function analyze_all (engine, templates, permissions) {
    const log = engine.log.bind(engine);
    const env = Environment({ templates, permissions });

    /* Perform initial analysis of the expressions in the templates */
    const shallow = templates.map(([args, ...defn], name) => {
        const ctx = { 
            env, name,
            calls:      new Set(),
            lookups:    new Set(),
            perms:      new Set(),
            errors:     [],
        };
        defn.forEach(e => analyze_expr(ctx, e));
        return ctx;
    });

    /* Find all calls recursively */
    const rr = f => {
        const m = shallow.get(f);
        const cs = imm.Seq(m.calls);
        return cs.concat(imm.Seq([f]), cs.flatMap(rr));
    };
    /* Compile a full-depth analysis of a template */
    const compile = name => {
        const calls = rr(name).toSet();
        const all = fn => calls.flatMap(f => fn(shallow.get(f)));
        const rv = Analysis({
            definition: templates.get(name),
            lookups:    all(m => m.lookups),
            perms:      all(m => m.perms),
            errors:     all(m => m.errors),
        });
        return rv;
    };
    const analyzed = templates.keySeq()
        /* This gives a Seq.Keyed (a, a), ... */
        .toSetSeq().toKeyedSeq()
        .map(compile)
        .toMap();
    return Environment({ permissions, templates: analyzed });
};

/** Analyze a single template expression and record the results into the
 * context object. */
function analyze_expr (ctx, expr) {
    if (is_scalar(expr))
        return;

    if (!Array.isArray(expr)) {
        Object.values(expr).forEach(e => analyze_expr(ctx, e));
        return;
    }

    const [name, ...args] = expr;
    if (name == "lookup") {
        const [svc, url, item] = args;
        if (!is_scalar(svc) || !is_scalar(url)) {
            ctx.errors.push(TError({ type: "lookup", detail: args }));
            return;
        }
        ctx.lookups.add(`${svc}/${url}`);
        analyze_expr(ctx, item);
    }
    else {
        if (name == ctx.name)
            ;/* Ignore recursive calls */
        else if (ctx.env.permissions.has(name))
            ctx.perms.add(name);
        else if (ctx.env.templates.has(name))
            ctx.calls.add(name);
        args.forEach(e => analyze_expr(ctx, e));
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
            this.log("New template env: %s", showJS(e)));
    }

    _build_env () {
        return rxx.rx(
            rx.combineLatest(
                /* XXX This is not limited to the Template class */
                this.fplus.ConfigDB.search_app(App.Template),
                this.permissions),
            /* This performs a complete analysis every time anything
             * changes. For now I think this is the simplest strategy,
             * pending evidence of performance problems. */
            rx.map(args => analyze_all(this, ...args)));
    }
}
