/*
 * ACS ConfigDB
 * What service-setup's retired-drivers step can and can't do
 * Copyright 2026 University of Sheffield
 *
 * acs-service-setup/lib/retired-drivers.js retires a driver whose
 * object a dump created with the Edge Agent driver class as its primary
 * class. Its tests run against a fake ConfigDB, which must refuse what
 * this one refuses. This runs the same operations against the real
 * Model and a migrated database: taking an object out of its primary
 * class is refused with 409 (the fault the first real upgrade hit), and
 * hiding its DriverDef, including after the DriverDef was deleted,
 * works and leaves it in the class.
 *
 * Needs PGHOST etc. pointing at a migrated ConfigDB database, as
 * class-scope.test.js does.
 */

import assert           from "node:assert/strict";
import { describe, test } from "node:test";

import { Class, SpecialObj } from "../lib/constants.js";
import Model            from "../lib/model.js";

const skip = !process.env.PGHOST && "set PGHOST etc. to a migrated ConfigDB database";

const debug = { bound: () => () => {}, log: () => {} };

describe("retiring a dump-created driver", { skip }, () => {
    let model, klass, driver, app;

    const mk = async (cls) => {
        const [code, info] = await model.object_create({
            class: cls, owner: SpecialObj.Unowned });
        assert.ok(code < 300, `create ${code}`);
        return info.uuid;
    };
    const get = () => model.config_get({ app, object: driver })
        .then(r => r?.config);

    test("set up a driver class, a driver in it and a DriverDef app", async () => {
        model = await new Model({ auth: {}, debug }).init();
        /* The driver class, and a driver whose primary class it is, as
         * the dumps create them. */
        klass = await mk(Class.Class);
        driver = await mk(klass);
        app = await mk(Class.App);
        const st = await model.config_put({ app, object: driver },
            { internal: { connType: "S7" }, polled: true });
        assert.ok(st < 300, `put ${st}`);
    });

    test("taking it out of its primary class is refused with 409", async () => {
        const st = await model.class_remove_member(klass, driver);
        assert.equal(st, 409);
        assert.ok(await model.class_has(klass, "membership", driver));
    });

    test("its DriverDef can be hidden, and it stays in the class", async () => {
        const def = await get();
        const st = await model.config_put({ app, object: driver },
            { ...def, hidden: true });
        assert.ok(st < 300, `put ${st}`);
        assert.deepEqual(await get(),
            { internal: { connType: "S7" }, polled: true, hidden: true });
        assert.ok(await model.class_has(klass, "membership", driver));
    });

    test("a DriverDef an earlier run deleted can be written back hidden", async () => {
        const del = await model.config_delete({ app, object: driver });
        assert.ok(del < 300, `delete ${del}`);
        assert.equal(await get(), undefined);

        const st = await model.config_put({ app, object: driver }, { hidden: true });
        assert.ok(st < 300, `put ${st}`);
        assert.deepEqual(await get(), { hidden: true });
    });
});
