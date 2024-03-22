/*
 * Factory+ / AMRC Connectivity Stack (ACS) Config Store component
 * Special Applications
 * Copyright 2021 AMRC
 */

import { App } from "../constants.js";

class SpecialApp {
    constructor (model) {
        this.model = model;
    }

    put (obj, json) { return 405; }
    delete (obj) { return 405; }
}

/* XXX These should work the other way: they should be stored as normal
 * config entries, and the ConfigDB code should look up what it needs in
 * the database like everyone else. Then they would get the benefit of
 * etags and any other future improvements to config handling
 * (e.g. transactions, ownership, ...).
 */

class ObjectRegistration extends SpecialApp {
    static application = App.Registration;

    list () {
        return this.model.object_list();
    }

    async get(obj) {
        const klass = await this.model.object_class(obj);
        if (klass == null) return null;
        return {
            json: {"class": klass},
        };
    }

    async put(obj, json) {
        const klass = json?.class;
        if (klass == null) return 400;
        return await this.model.object_set_class(obj, klass);
    }
}

class ConfigSchema extends SpecialApp {
    static application = App.ConfigSchema;

    list () {
        return this.model.app_schema_list();
    }

    async get (obj) {
        const rv = await this.model.app_schema(obj);
        if (rv == null) return;
        return { json: rv.schema };
    }

    async put (obj, json) {
        const rv = await this.model.app_schema_update(obj, json);
        
        if (rv === null)
            return 422;
        else if (rv === true)
            return 204;
        else if (rv === false)
            /* XXX Properly we should distinguish here between 404 for
             * object-not-found and 405 for object-is-not-an-app. */
            return 405;
        else
            /* XXX The /config-schema endpoint returned a list of
             * conflicting objects, which we now throw away. This
             * convention could be generalised? */
            return 409;
    }
}

export const Specials = [ObjectRegistration, ConfigSchema];
