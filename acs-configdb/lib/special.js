/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * Special Applications
 * Copyright 2021 AMRC
 */

import { App } from "./constants.js";

class SpecialApp {
    constructor (model) {
        this.model = model;
        this.log = model.log;
    }

    /* These are called from within a transaction */
    validate (query, obj, config) { return { status: 405 }; }
    delete (query, obj) { return 405; }
}

/* XXX These should work the other way: they should be stored as normal
 * config entries, and the ConfigDB code should look up what it needs in
 * the database like everyone else. Then they would get the benefit of
 * etags and any other future improvements to config handling
 * (e.g. transactions, ownership, ...).
 *
 * Idea: these are both sideways caches, in that we the ConfigDB need
 * access to the information in a form other than JSON. They both also
 * need different validation from normal entries. So maybe all we need
 * here is a pre-PUT validate-and-cache method which can update our
 * sideways storage (object table, schema cache).
 */

class ObjectRegistration extends SpecialApp {
    static application = App.Registration;

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
            return { status: 422 };

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
            return { status: 409, body: bad };

        this.model.schemas.set(app, validate);
        return { status: 204 };
    }

    delete (query, app) {
        this.model.schemas.delete(app);
        return 204;
    }
}

export const SpecialApps = [ObjectRegistration, ConfigSchema];
