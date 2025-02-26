/*
 * Factory+ / AMRC Connectivity Stack (ACS) Directory component
 * API v1 model
 * Copyright 2021 AMRC
 */

import {DB, Pg} from "@amrc-factoryplus/pg-client";
import Queries from "./queries.js";
import {Service_UUID} from "./constants.js";

export default class Model extends Queries {
    constructor(opts) {
        const db = new DB({
            version: Queries.DBVersion,
            isolation: "read committed",
            readonly: !!opts.readonly,
            debug: opts.debug,
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
            /* Record links before alerts, we need the records for the
             * alert-link link table */
            for (const lnk of opts.links)
                await q.record_link(devid, lnk);
            await q.record_stale_links(devid,
                Object.values(opts.links).map(l => l.uuid));
            for (const alrt of opts.alerts)
                await q.record_alert(devid, alrt);
            await q.record_stale_alerts(devid,
                Object.values(opts.alerts).map(a => a.uuid));

        });
    }

    /* Returns a list of UUIDs of devices we have closed session for. */
    async death(opts) {
        /* XXX I should be recording and checking bdSeq here... if it can be trusted. */

        const addr = opts.address;
        const time = opts.time;

        await this.txn(q => q.record_death(time, addr));
    }

    dump_validate(dump){
        if (typeof (dump) != "object") {
            console.log("Dump not an object");
            return false;
        }
        if (dump.service != Service_UUID) {
            console.log("Dump not for Directory");
            return false;
        }
        if (dump.version != 1) {
            console.log("Dump should be version 1");
            return false;
        }
        if(dump.advertisements.length === 0){
            console.log("Dump doesn't contain urls to register")
            return false;
        }
        return true;
    }

    async dump_load(req) {
        const dump = req.body;
        if (!this.dump_validate(dump)){
            return 400;
        }
        for (const advertisement of dump.advertisements) {
            if(!advertisement.device){
                continue;
            }
            await this.record_service({
                service: advertisement.service,
                url: advertisement.url,
                device: advertisement.device,
            })
        }
        return 200;
    }

    /* ALERTS */

    update_alerts (updates) {
        return this.txn(async q => {
            for (const up of updates) {
                await q.update_alert_active(...up);
            }
        });
    }
}
