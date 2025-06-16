/*
 * ACS ConfigDB
 * Linked Data Fragment server
 * Copyright 2025 University of Sheffield AMRC
 */

import { Readable }         from "stream";

import canonicalize         from "canonicalize";
import N3                   from "n3";
import { QueryEngine }      from "@comunica/query-sparql-rdfjs";

import { UUIDs }            from "@amrc-factoryplus/service-client";

import { Perm }             from "./constants.js";

const { namedNode, literal, variable, quad } = N3.DataFactory;

const PREFIXES = {
    owl: "http://www.w3.org/2002/07/owl#",
    rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    hydra: "http://www.w3.org/ns/hydra/core#",
    void: "http://rdfs.org/ns/void#",
    uuid: "urn:uuid:",
};

const uuid = u => namedNode(`urn:uuid:${u}`);
const iri = qn => {
    const [pfx, local] = qn.split(":");
    return namedNode(`${PREFIXES[pfx]}${local}`);
};

/* XXX For now use a fixed UUID for the dataset */
const DS = "0dd323cc-4070-11f0-838c-b741b85bb136";

const WK = {
    ds:         iri(`uuid:${DS}`),
    type:       iri("rdf:type"),
    subclass:   iri("rdfs:subClassOf"),
    json:       iri("rdf:JSON"),
    triples:    iri("void:triples"),
    subset:     iri("void:subset"),
};

const Relations = [
    [WK.type,       "all_membership"],
    [WK.subclass,   "all_subclass"],
];

function from_ttl (ttl) {
    const ttlp = Object.entries(PREFIXES)
        .map(([p, u]) => `@prefix ${p}: <${u}>.`)
        .join("\n");
    return new N3.Parser().parse(ttlp + ttl);
}

function to_ttl (quads) {
    return new Promise((resolve, reject) => {
        const w = new N3.Writer({ prefixes: PREFIXES });
        w.addQuads(quads);
        w.end((err, ttl) => {
            if (err) reject(err);
            resolve(ttl);
        });
    });
}

function decode (q) {
    if (q == null || q == "")
        return variable();
    if (q.startsWith("?"))
        return variable(q.substring(1));
    if (q.startsWith(`"`)) {
        const [all, val, lang, type] = 
            /"(.*)"(?:\^\^([^"]+)|@([^"]+))/.exec(q) ?? [];
        if (!all) throw `Bad literal: ${q}`;
        return literal(val, type ? namedNode(type) : lang);
    }
    return namedNode(q);
}

function to_fp (term) {
    if (term == null || term.termType == "Variable")
        return { variable: true, ok: true };
    if (term.termType != "NamedNode")
        return { ok: false };
    const url = term.value;
    if (!url.startsWith("urn:uuid:"))
        return { ok: false }
    return { ok: true, uuid: url.substring(9) };
}

class QueryError extends Error {
    constructor (st) {
        super(`RDF query error: ${st}`);
        this.status = st;
    }
}

function err_stream (st) {
    return new Readable({
        read () {
            this.destroy(new QueryError(st));
        }
    });
}

class FPQuadSource {
    constructor (opts) {
        this.auth = opts.auth;
        this.model = opts.model;
        this.princ = opts.princ;
        this.log = opts.log;
    }

    match (subj, pred, obj) {
        if (!pred || pred.termType == "Variable")
            return err_stream(403);

        return this.core_rel(subj, pred, obj)
            || this.application(subj, pred, obj);
    }

    core_rel (subj, pred, obj) {
        const rel =
            WK.type.equals(pred)        ? "all_membership"
            : WK.subclass.equals(pred)  ? "all_subclass"
            : null;
        if (!rel) return;

        const memb = to_fp(subj);
        const klass = to_fp(obj);
        if (!memb.ok || !klass.ok)
            return Readable.from([]);

        return Readable.from([[memb, klass]])
            .flatMap(async ([memb, klass]) => {
                const aopts = klass.variable ? [UUIDs.Null, false] : [klass.uuid, true];
                const ok = await this.auth.check_acl(this.princ, Perm.Manage_Obj, 
                    ...aopts);
                if (!ok) return err_stream(403);

                if (memb.uuid) {
                    const klasses = await this.model.object_lookup(memb.uuid, rel);
                    return klasses.map(k => quad(subj, WK.type, uuid(k)));
                }
                if (klass.uuid) {
                    const membs = await this.model.class_lookup(klass.uuid, rel);
                    return membs.map(o => quad(uuid(o), WK.type, obj));
                }
                const all = await this.model.relation_lookup(rel);
                return all.map(([o, c]) => quad(uuid(o), WK.type, uuid(c)));
            });
    }

    application (subj, pred, filter) {
        if (filter && filter.termType != "Variable")
            return err_stream(403);

        const obj = to_fp(subj);
        if (!obj.ok) return Readable.from([]);

        const app = to_fp(pred);
        if (!app.ok) return Readable.from([]);

        return Readable.from([1])
            .flatMap(async () => {
                const ok = await this.auth.check_acl(this.princ, Perm.Read_App,
                    app.uuid, true);
                if (!ok) return err_stream(403);

                const objs = obj.uuid ? [obj.uuid]
                    : await this.model.config_list(app.uuid);
                this.log("OBJS: %o", objs);
                return Promise.all(
                    objs.map(o => {
                        return this.model.config_get({app: app.uuid, object: o})
                            .then(c => canonicalize(c.config))
                            .then(j => literal(j, WK.json))
                            .then(c => quad(uuid(o), pred, c))
                    }));
            });
    }
}

export class RDF {
    constructor (opts) {
        this.auth = opts.auth;
        this.model = opts.model;

        this.log = opts.debug.bound("ldf");

        this.engine = new QueryEngine();
    }

    async init () {
        /* Get SparqlEngine preferred content-types */
        const types = await this.engine.getResultMediaTypes();
        this.sparql_types = Object.entries(types)
            .filter(e => e[0].includes("/"))
            .toSorted((a, b) => b[1] - a[1])
            .map(e => e[0]);
        return this;
    }

    source (princ) {
        return new FPQuadSource({
            auth:   this.auth,
            model:  this.model,
            princ,
            log:    this.log,
        });
    }

    control (template) {
        return from_ttl(`
            uuid:${DS} hydra:search [
                hydra:template "${template}";
                hydra:mapping [hydra:variable "s"; hydra:property rdf:subject],
                    [hydra:variable "p"; hydra:property rdf:predicate],
                    [hydra:variable "o"; hydra:property rdf:object];
                ].
        `);
    }

    async qpf_query (opts) {
        const q = opts.query.map(decode);

        const quads = this.control(opts.template);
        this.log("Control: %o", quads);
        if (q.some(n => n.termType != "Variable")) {
            const src = this.source(opts.auth);
            const out = await src.match(...q).toArray();
            const frag = namedNode(opts.fragment);

            quads.push(...out,
                quad(frag, iri("void:triples"), literal(out.length)),
                quad(WK.ds, iri("void:subset"), frag));
        }
        this.log("Turtle: %o", quads);
        return to_ttl(quads);
    }

    sparql_query (query, princ, type) {
        const { engine } = this;

        const src = this.source(princ);
        return engine.query(query, {
            sources: [ src ],
        })  
            .then(r => engine.resultToString(r, type))
            .then(r => [200, r.data])
            .catch(e => {
                if (e instanceof QueryError)
                    return [e.status];
                this.log("Query error: %o", e);
                return [500];
            });
    }
}
