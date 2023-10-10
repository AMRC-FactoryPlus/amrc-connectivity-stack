/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Sync Op
 * Cluster node list updates
 * Copyright 2023 AMRC
 */

import child_process from "child_process";

import concat_stream from "concat-stream";
import rx from "rxjs";

import { ServiceError } from "@amrc-factoryplus/utilities";

import { Edge } from "./uuids.js";

export class Kubeseal {
    constructor (opts) {
        this.cdb = opts.fplus.ConfigDB;
        this.log = opts.fplus.debug.log.bind(opts.fplus.debug, "kubeseal");

        this.cluster = opts.cluster;
        this.namespace = opts.namespace;
        this.controller = opts.controller;
    }

    async init () { return this; }

    run () {
        rx.timer(5000, 86400000).pipe(
            rx.tap(v => this.log("Fetching current Kubeseal certificate")),
            rx.mergeMap(v => this.fetch_cert()),
            rx.switchMap(cert => this.push_kubeseal(cert)),
        ).subscribe();
    }

    fetch_cert () {
        return new Promise(resolve => {
            const kid = child_process.spawn("/usr/local/bin/kubeseal", [
                "--controller-namespace", this.namespace,
                "--controller-name", this.name,
                "--fetch-cert"]);
            kid.stderr.pipe(concat_stream({ encoding: "string" }, 
                err => err && this.log("Kubeseal error: %s", err)));
            kid.stdout.pipe(concat_stream({ encoding: "string" }, resolve));
        });
    }

    push_kubeseal (cert) {
        const app = Edge.App.ClusterStatus;
        const data = { kubeseal_cert: cert };

        return this.cdb.patch_config(app, this.cluster, "merge", data)
            .catch(err => {
                if (!(err instanceof ServiceError && err.status == 404))
                    throw err;
                return this.cdb.put_config(app, this.cluster, data);
            })
            .then(() => this.log("Updated Kubeseal certificate"));
    }
}
