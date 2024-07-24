/*
 * Factory+ / AMRC Connectivity Stack (ACS) Edge Sync Op
 * Cluster node list updates
 * Copyright 2023 AMRC
 */

import child_process from "child_process";
import util from "util";

import concat_stream from "concat-stream";
import rx from "rxjs";

import { ServiceError } from "@amrc-factoryplus/service-client";

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
            rx.switchMap(() => rx.of(1).pipe(
                rx.mergeMap(v => this.fetch_cert()),
                rx.filter(v => v != null),
                rx.throwIfEmpty(),
                rx.retry({ delay: 60000 }))),
            rx.switchMap(cert => rx.of(cert).pipe(
                rx.mergeMap(cert => this.push_kubeseal(cert)),
                rx.retry({ delay: 5000 }))),
        ).subscribe();
    }

    async fetch_cert () {
        this.log("Fetching current kubeseal certificate");

        const kid = child_process.spawn("/usr/local/bin/kubeseal", [
            "--controller-namespace", this.namespace,
            "--controller-name", this.controller,
            "--fetch-cert"]);

        const get_stream = str => new Promise(resolve =>
            str.pipe(concat_stream({ encoding: "string" }, resolve)));

        const [cert, err, exit] = await Promise.all([
            get_stream(kid.stdout),
            get_stream(kid.stderr),
            new Promise(res => kid.on("exit", res)),
        ]);

        if (err)
            this.log("Error from kubeseal: %s", err);
        if (exit !== 0) {
            this.log("Kubeseal failed with exit code %o", exit);
            return;
        }

        return cert;
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
