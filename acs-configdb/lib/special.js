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
    validate (query, obj, config) { return 405; }
    delete (query, obj) { return 405; }
}

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

export const SpecialApps = [ObjectRegistration, ConfigSchema];
