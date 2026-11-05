/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * Special Applications
 * Copyright 2021 AMRC
 */

import { isa95_chain, isa95_vocabulary } from "@amrc-factoryplus/service-client";

import { App, ISA95Level } from "./constants.js";

class SpecialApp {
    constructor (model) {
        this.model = model;
        this.log = model.log;
    }

    /* These are called from within a transaction */
    validate (query, obj, config) { return 405; }
    delete (query, obj) { return 405; }

    /* This is called after the transaction if we changed anything */
    notify (obj, config) { }
}

class ObjectRegistration extends SpecialApp {
    static application = App.Registration;

    validate (query, obj, spec) {
        return this.model.update_registration(query, obj, spec);
    }

    notify (obj, config) {
        this.model.updates.next({ type: "class" });
    }
}

class ConfigSchema extends SpecialApp {
    static application = App.ConfigSchema;

    parse (schema) {
        try {
            return this.model.ajv.compile(schema);
        } catch (e) {
            this.log("Error parsing schema: %s", e);
            return;
        }
    }

    async validate (query, app, schema) {
        /* XXX Validate app is an app? */

        const validate = this.parse(schema);
        if (!validate)
            return 422;

        const configs = await query(`
            select o.uuid object, c.json
            from config c
                join object o on o.id = c.object
            where c.app = $1
        `, [app]).then(dbr => dbr.rows);

        const bad = configs
            .filter(r => !validate(r.json))
            .map(r => r.object);
        if (bad.length > 0)
            return 409;

        this.model.schemas.set(app, validate);
        return 204;
    }

    delete (query, app) {
        this.model.schemas.delete(app);
        return 204;
    }
}

/* Check an ISA-95 placement against the vocabulary.
 * `lookup` answers, for a node UUID, its level name (or undefined) and
 * the UUIDs of the nodes whose vocabulary config lists it as a child.
 * Returns undefined if the placement is good, or the reason it is not.
 */
export async function placement_problem (placement, lookup) {
    const node = placement?.node;
    if (typeof node != "string")
        return "no node";

    /* Walk up every parent from the node. A clean chain is at most
     * five nodes; stop well before a cycle could run away. */
    const nodes = new Map();
    const todo = [node];
    while (todo.length) {
        const uuid = todo.shift();
        if (nodes.has(uuid)) continue;
        if (nodes.size >= 16)
            return "the vocabulary above this node is not a tree";
        const [level, parents] = await Promise.all([
            lookup.level_of(uuid), lookup.parents_of(uuid)]);
        nodes.set(uuid, { uuid, name: uuid, level, children: [], parents });
        todo.push(...parents);
    }
    for (const n of nodes.values())
        for (const p of n.parents)
            nodes.get(p).children.push(n.uuid);

    return isa95_chain(isa95_vocabulary(nodes.values()), node).error;
}

/* Each device's place in the ISA-95 vocabulary. The ConfigSchema
 * checks the shape; this checks that the node is a vocabulary node
 * with an unbroken chain up to its Enterprise. */
class ISA95Placement extends SpecialApp {
    static application = App.ISA95Placement;

    lookup (query) {
        const levels = Object.entries(ISA95Level);
        return {
            level_of: uuid => query(`
                select l.uuid::text level
                from object l
                    join object n on n.uuid = $1
                where l.uuid = any($2::uuid[])
                    and class_has_member(l.id, n.id)
            `, [uuid, levels.map(([, u]) => u)])
                .then(dbr => dbr.rows.map(r =>
                    levels.find(([, u]) => u == r.level)[0]))
                /* A node in two level classes has no single level. */
                .then(ls => ls.length == 1 ? ls[0] : undefined),

            /* jsonb `?`: the children array holds this UUID. */
            parents_of: uuid => query(`
                select o.uuid::text uuid
                from config c
                    join object a on a.id = c.app
                    join object o on o.id = c.object
                where a.uuid = $1
                    and c.json->'children' ? $2
            `, [App.ISA95Vocabulary, uuid])
                .then(dbr => dbr.rows.map(r => r.uuid)),
        };
    }

    async validate (query, obj, placement) {
        const problem = await placement_problem(placement, this.lookup(query));
        if (!problem) return 204;
        this.log("Refusing ISA-95 placement %o: %s", placement, problem);
        return 422;
    }

    delete (query, obj) { return 204; }
}

export const SpecialApps = [ObjectRegistration, ConfigSchema, ISA95Placement];
