/*
 * ACS Auth service
 * Test fixtures: a DataFlow driven by a scripted notify SEARCH
 * Copyright 2026 University of Sheffield AMRC
 */

import imm from "immutable";
import * as rx from "rxjs";

import { NotifyV2 } from "@amrc-factoryplus/rx-client";
import * as rxx from "@amrc-factoryplus/rx-util";
import { UUIDs } from "@amrc-factoryplus/service-client";

import { DataFlow } from "../lib/dataflow.js";
import { Class, Special } from "../lib/uuids.js";

export const RegPath = `v2/app/${UUIDs.App.Registration}/object/`;

const quiet = () => () => {};

/** A NotifyV2 whose SEARCH responses come from a Subject.
 * Push raw notify/v2 updates with `updates.next(u)`. Every SEARCH
 * request made against this object sees the same updates, so an old
 * and a new pipeline can share one stream. */
export function scripted_notify () {
    const notify = new NotifyV2({ log: quiet(), debug: { bound: quiet } });
    const updates = new rx.Subject();
    notify.requests = [];
    notify.request = req => {
        notify.requests.push(req);
        return updates;
    };
    return { notify, updates };
}

/** A fake ConfigDB with fixed class membership.
 * @param notify A NotifyV2 to run SEARCH requests against.
 * @param classes Membership of the principal and permission classes.
 */
export function fake_cdb (notify, classes) {
    const members = {
        [Class.Principal]:  imm.Set(classes.principals),
        [Class.Permission]: imm.Set(classes.permissions),
    };
    const powersets = {
        [Class.Principal]:  imm.Map(classes.principal_groups)
            .map(ms => imm.Set(ms)),
        [Class.Permission]: imm.Map(classes.permission_groups)
            .map(ms => imm.Set(ms)),
    };
    return {
        search_app (app, filter) {
            return notify.search(`v2/app/${app}/object/`, filter);
        },
        search_app_changes (app, filter) {
            return notify.search_changes(`v2/app/${app}/object/`, filter);
        },
        watch_members: k => rx.of(members[k] ?? imm.Set()),
        watch_powerset: k => rx.of(powersets[k] ?? imm.Map()),
        expand_members: () => rx.map(gs =>
            imm.Map(imm.Seq(gs).map(g => [g, imm.Set()]))),
    };
}

/** The `_build_owned` implementation from main, kept verbatim.
 * This is the reference the differential tests compare against. */
export class ReferenceDataFlow extends DataFlow {
    _build_owned () {
        const { cdb } = this;
        const { App } = UUIDs;

        return rxx.rx(
            cdb.search_app(App.Registration),
            rx.map(es => es.entrySeq()
                .map(([obj, inf]) => [obj, inf.owner])
                .filter(([obj, owner]) => owner != Special.Unowned)
                .groupBy(([obj, owner]) => owner)
                .toMap()
                .map(es => new imm.Set(es.map(e => e[0])))),
            rx.shareReplay(1));
    }
}

/** Build a DataFlow over a fake ConfigDB and a fixed grant list.
 * Waits until the grant and identity fetches have resolved, so the
 * ACL sequences then react synchronously to SEARCH updates. */
export async function make_dataflow (Klass, cdb, grants) {
    const model = {
        grant_get_all:      async () => grants,
        identity_get_all:   async () => [],
    };
    const fplus = { debug: { bound: quiet }, ConfigDB: cdb };
    const df = new Klass({ fplus, model, root_principal: "root@TEST" });
    await rx.firstValueFrom(df.grants);
    await rx.firstValueFrom(df.identities);
    return df;
}

/** Notify update builders. */
export const upd = {
    /* A full SEARCH snapshot. `kids` maps child to [status, body]. */
    full (kids, status = 200) {
        const children = kids && Object.fromEntries(
            Object.entries(kids).map(([k, [st, body]]) =>
                [k, { status: st, body }]));
        return {
            status: 201,
            response: { status, body: undefined, headers: {} },
            ...(children ? { children } : {}),
        };
    },
    /* A child update. Status 404 means the child has gone. */
    child (child, status, body) {
        return {
            status: 200,
            child,
            response: { status, body, headers: {} },
        };
    },
};
