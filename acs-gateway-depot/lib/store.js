/*
 * ACS Gateway Depot
 * Keeps the gateways. Lasting facts go to the ConfigDB; live ones stay
 * here.
 * Copyright 2026 University of Sheffield AMRC
 */

/* A gateway gets a ConfigDB object when someone approves it. From then
 * on its record (hardware, settings, state, who did what) is a ConfigDB
 * entry, so it survives this service and can be read by anything else
 * in ACS. A machine that is only waiting for approval is not written
 * anywhere: an unknown machine on the network must not be able to
 * create ConfigDB objects by calling in.
 *
 * What changes every few seconds (when the gateway last called, whether
 * a cable is in, its log) is kept in memory only. The ConfigDB keeps a
 * history of every write and this would bury it. */

import { App, Class }   from "./constants.js";

/* The fields of a gateway that go to the ConfigDB. */
function record (box) {
    return {
        scout_id:       box.id,
        state:          box.state,
        first_seen:     box.first_seen,
        inventory:      box.inventory,
        settings:       box.settings,
        approved_by:    box.approved_by,
        approved_at:    box.approved_at,
        install_started_at: box.install_started_at,
        installed_at:   box.installed_at,
        ready_at:       box.ready_at,
        onboarded_at:   box.onboarded_at,
        replaced_at:    box.replaced_at,
        install_failed: box.install_failed,
        replaces:       box.replaces,
        replaced_by:    box.replaced_by,
        onboard:        box.onboard,
        /* Which port is which and what address it has, but not whether
         * a cable is in, which flaps. */
        report:         box.report && {
            hostname:   box.report.hostname,
            north:      box.report.north,
            south:      box.report.south,
            k3s:        box.report.k3s,
            nics:       box.report.nics?.map(n =>
                ({ name: n.name, mac: n.mac, ipv4: n.ipv4 })),
        },
    };
}

function display_name (box) {
    return box.report?.hostname
        ?? `Gateway ${box.inventory?.serial || box.id.slice(0, 8)}`;
}

export class Store {
    constructor (opts) {
        this.cdb = opts.fplus.ConfigDB;
        this.log = opts.fplus.debug.bound("store");

        this.boxes = new Map();     /* scout id -> gateway */
        this.saved = new Map();     /* scout id -> JSON last written */
        this.names = new Map();     /* scout id -> name last written */
        this.queue = new Map();     /* scout id -> the write in progress */
    }

    /* Read every gateway back from the ConfigDB. */
    async init () {
        const { cdb } = this;

        const uuids = await cdb.list_configs(App.Gateway);
        for (const uuid of uuids) {
            const pub = await cdb.get_config(App.Gateway, uuid);
            const priv = await cdb.get_config(App.Private, uuid);
            if (!pub?.scout_id || !priv?.secret_hash) {
                this.log("Skipping incomplete gateway record %s", uuid);
                continue;
            }
            const { scout_id, ...rest } = pub;
            const box = { id: scout_id, uuid, ...rest, ...priv };
            this.boxes.set(box.id, box);
            this.saved.set(box.id, JSON.stringify(record(box)));
            this.names.set(box.id, display_name(box));
        }
        this.log("Loaded %s gateways from the ConfigDB", this.boxes.size);
        return this;
    }

    get (id) { return this.boxes.get(id); }
    list () { return [...this.boxes.values()]; }

    /* Give an approved gateway its ConfigDB object. The caller awaits
     * this, so approval fails if the ConfigDB cannot take it. */
    async create (box) {
        box.uuid = await this.cdb.create_object(Class.Gateway);
        await this.cdb.put_config(App.Private, box.uuid, {
            secret_hash:    box.secret_hash,
            password_hash:  box.password_hash,
        });
        this.boxes.set(box.id, box);
        await this.write(box);
    }

    async write (box) {
        const json = JSON.stringify(record(box));
        if (this.saved.get(box.id) != json) {
            await this.cdb.put_config(App.Gateway, box.uuid, JSON.parse(json));
            this.saved.set(box.id, json);
        }
        const name = display_name(box);
        if (this.names.get(box.id) != name) {
            await this.cdb.put_config(App.Info, box.uuid, { name });
            this.names.set(box.id, name);
        }
    }

    /* Remember a change. Returns at once; the ConfigDB write, if one is
     * needed, follows in the background, one at a time per gateway. */
    put (box) {
        this.boxes.set(box.id, box);
        if (!box.uuid) return;
        const prev = this.queue.get(box.id) ?? Promise.resolve();
        const next = prev
            .then(() => this.write(box))
            .catch(e => this.log("Cannot save gateway %s: %s", box.id, e));
        this.queue.set(box.id, next);
    }

    async remove (id) {
        const box = this.boxes.get(id);
        this.boxes.delete(id);
        this.saved.delete(id);
        this.names.delete(id);
        if (!box?.uuid) return;

        await this.queue.get(id);
        await this.cdb.delete_config(App.Gateway, box.uuid);
        await this.cdb.delete_config(App.Private, box.uuid);
        await this.cdb.delete_config(App.Info, box.uuid)
            .catch(e => this.log("Cannot remove name of %s: %s", box.uuid, e));
        await this.cdb.delete_object(box.uuid)
            .catch(e => this.log("Cannot remove object %s: %s", box.uuid, e));
    }
}
