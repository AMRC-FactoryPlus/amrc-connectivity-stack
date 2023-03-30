/*
 * Factory+ / AMRC Connectivity Stack (ACS) Directory component
 * API v1 model
 * Copyright 2021 AMRC
 */

import {DB, Pg} from "@amrc-factoryplus/utilities";
import Queries from "./queries.js";

export default class Model extends Queries {
    constructor(opts) {
        const db = new DB({
            version: Queries.DBVersion,
            isolation: "read committed",
            readonly: !!opts.readonly,
            verbose: !!opts.verbose,
        });

        super(db.query.bind(db))
        this.db = db;
    }

    async init() {
        await this.db.init();
        return this;
    }

    txn(work) {
        return this.db.txn({}, q => work(new Queries(q)));
    }

    async notify_client(channels, callback) {
        const cli = new Pg.Client();
        await cli.connect();

        cli.on("notification", callback);
        for (const c of channels)
            await cli.query(`listen ${c}`);

        return cli;
    }

    /* ADDRESSES */

    async addr_node(group, node) {
        return await this.txn(async q => {
            const uuid = await q.addr_uuid(group, node, "");
            const list = await q.addr_devices(group, node);
            return {uuid, list};
        });
    }

    async addr_device(group, node, device) {
        return await this.addr_uuid(group, node, device);
    }

    /* BIRTH/DEATH */

    async birth(opts) {
        return this.txn(async q => {
            const addrid = await q.find_or_create_address(opts.address);

            /* XXX This wants revisiting... probably we should be
             * querying the ConfigDB instead, and maybe refusing to
             * index the device if it isn't present there. */
            const uuid = opts.uuid ??
                await q.find_or_create_missing_uuid(addrid);

            const devid = await q.find_or_create("device", uuid);
            if (devid == null) return;

            const sess = await q.record_birth({
                devid,
                addrid,
                time: opts.time,
                top_schema: opts.top_schema,
            });

            for (const schema of opts.schemas)
                await q.record_schema(sess, schema);

            if (opts.service) {
                await q.record_service({
                    service: opts.service.uuid,
                    owner: uuid,
                    device: devid,
                    url: opts.service.url,
                });
            }
        });
    }

    /* Returns a list of UUIDs of devices we have closed session for. */
    async death(opts) {
        /* XXX I should be recording and checking bdSeq here... if it can be trusted. */

        const addr = opts.address;
        const time = opts.time;

        await this.txn(q => q.record_death(time, addr));
    }
}
