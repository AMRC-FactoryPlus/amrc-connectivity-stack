/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Sync Op
 * Deployment operator
 * Copyright 2023 AMRC
 */

import deep_equal       from "deep-equal";
import * as imm         from "immutable";
import k8s              from "@kubernetes/client-node";
import rx               from "rxjs";
import template         from "json-templates";

import { Debug, ServiceError, UUIDs } from "@amrc-factoryplus/utilities";

import { Edge }             from "./uuids.js";

export class Deployments {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.cluster = opts.cluster;
       
        this.log = opts.fplus.debug.log.bind(opts.fplus.debug, "deploy");
    }

    async init () {
        const cdb = this.fplus.ConfigDB;
        this.log("Creating ConfigDB watcher");
        const watcher = await cdb.watcher();
        this.log("Got watcher: %o", watcher);

        const template = await this._init_template();
        const deployments = await this._init_deployments();

        this.reconcile = rx.combineLatest({ template, deployments }).pipe(
            rx.tap({ error: e => this.log("Error: %s", e) }),
            rx.retry({ delay: 5000 }),
        );

        return this;
    }

    run () {
        this.reconcile.subscribe(opts => this.handle_deployments(opts));
    }

    async _init_template () {
        const watcher = await this.fplus.ConfigDB.watcher();
        const app = Edge.App.SyncConfig;
        return watcher.watch_config(app, app).pipe(
            rx.map(conf => conf.templates.helm_release),
            rx.distinctUntilChanged(deep_equal),
        );
    }

    async _init_deployments () {
        const app = Edge.App.Deployments;
        const cdb = this.fplus.ConfigDB;
        const watcher = await cdb.watcher();

        const lookup = list => rx.from(list).pipe(
            rx.mergeMap(agent => cdb.get_config(app, agent)
                .then(conf => ({ uuid: agent, config: conf }))),
            rx.toArray(),
        );

        return watcher
            .watch_search(app, { cluster: this.cluster })
            .pipe(rx.mergeMap(lookup));
    }

    handle_deployments (opts) {
        this.log("Reconcile needed: %o", opts);

        const helm = template(opts.template);
        const manifests = opts.deployments
            .flatMap(dep => dep.config.charts
                .map(chart => helm({
                    uuid: dep.uuid,
                    chart: chart,
                    values: {
                        uuid: dep.uuid,
                        hostname: dep.config.hostname,
                    },
                })));
        this.log("Manifests: %o", manifests);
    }
}
