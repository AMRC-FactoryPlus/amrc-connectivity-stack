/*
 * Factory+ / AMRC Connectivity Stack (ACS) Git server
 * Make current repo status available
 * Copyright 2024 AMRC
 */

import { Buffer }   from "buffer";
import fs           from "fs";
import timers       from "timers/promises";
import util         from "util";

import imm          from "immutable";
import git          from "isomorphic-git";
import rx           from "rxjs";

import * as rxx     from "@amrc-factoryplus/rx-util";

import { Git }  from "./uuids.js";

export class RepoStatus {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.data = opts.data;
        this.fifo = opts.pushes;

        this.log = this.fplus.debug.bound("status");

        this.configs = this._init_configs();
        this.changed = new rx.Subject();
        this.pushes = this._init_pushes();
        this.status = this._init_status();
    }

    async init () {
        return this;
    }

    run () {
        this.configs.subscribe(cs => this.log("CONFIGS: %o", cs.toJS()));
        this.status.subscribe(st => this.log("STATUS: %o", st.toJS()));
        this.pushes.subscribe(p => this.log("PUSH: %s", p));
    }

    /* A sequence returning our current set of config entries. This
     * returns an imm.Map and doesn't remove duplicates. */
    _init_configs () {
        const app = Git.App.Config;
        const cdb = this.fplus.ConfigDB;

        const fetch = () => rx.from(cdb.list_configs(app)).pipe(
            rx.mergeAll(),
            rx.mergeMap(uuid => cdb.get_config(app, uuid)
                .then(conf => [uuid, conf])),
            rx.reduce((map, kv) => map.set(...kv), imm.Map()),
        );

        return rx.defer(() => cdb.watcher()).pipe(
            rx.mergeMap(w => w.application(Git.App.Config)),
            /* Fetch regardless every 10 minutes */
            rx.mergeWith(rx.timer(0, 10*60*1000).pipe(
                /* Jitter fetches */
                rx.delayWhen(() => rx.timer(Math.random() * 5000)))),
            rx.switchMap(fetch),
            rxx.shareLatest(),
        );
    }

    _init_status () {
        const repos = this.configs.pipe(
            rx.map(cfs => cfs.keySeq().toSet()),
            rx.startWith(imm.Set()),
            rx.pairwise(),
            rx.mergeMap(([then, now]) => rx.concat(
                then.subtract(now).map(u => [false, u]),
                now.subtract(then).map(u => [true, u]),
            )),
        );

        return rx.merge(repos, this.changed, this.pushes).pipe(
            /* Unusually we need to use concatMap here to avoid
             * concurrency. This is because adds and deletes need to be
             * kept in the right order. We could mess with groupBy to be
             * concurrent across different repos but let's not bother. */
            rx.concatMap(([op, uuid]) => 
                (op ? this.branches(uuid) : rx.of(null)).pipe(
                    rx.map(v => [uuid, v]))),
            rx.scan((map, [k, v]) => v ? map.set(k, v) : map.delete(k),
                imm.Map()),
            rx.auditTime(1000),
            rxx.shareLatest(),
        );
    }

    _init_pushes () {
        const fsp = fs.promises;

        /* We expect writes to the fifo to consist of 36 bytes of
         * string-format UUID followed by a newline. */
        const read_fifo = async (fh, stop, obs) => {
            const buf = Buffer.alloc(1024);
            let end = 0;
            while (!stop[0]) {
                const st = await fh.read(buf, end, 1024-end);
                end += st.bytesRead;
                /* This is a belt-and-braces safety check. We previously
                 * had a bug that resulted in a tight loop here. */
                if (st.bytesRead == 0) {
                    this.log("EOF ON FIFO, SLEEPING");
                    await timers.setTimeout(5000);
                }
                while (end > 36) {
                    if (buf[36] != 10)
                        throw new Error(util.format("Bad read from fifo: [%s]", 
                            buf.toString("utf8", 0, 37)));
                    const uuid = buf.toString("utf8", 0, 36);
                    obs.next(uuid);
                    buf.copy(buf, 0, 37, end);
                    end -= 37;
                }
            }
        };

        return rxx.rx(
            /* The git push hook opens and closes the write end of the
             * FIFO. We must also hold the write end open, without
             * writing, as otherwise we get EOF on every read instead of
             * blocking. */
            rx.defer(() => fsp.open(this.fifo, "r+")),
            rx.mergeMap(fh => new rx.Observable(obs => {
                const stop = [false];
                read_fifo(fh, stop, obs);
                return () => {
                    stop[0] = true;
                    fh.close();
                };
            })),
            rx.map(u => [true, u]),
            /* This sequence MUST be shared. Multiple readers on a FIFO
             * are not supported. */
            rx.share(),
        );
    }

    branches (uuid) {
        const gitdir = `${this.data}/${uuid}`;
        return rx.from(git.listBranches({ fs, gitdir })).pipe(
            rx.mergeAll(),
            rx.mergeMap(ref => git.resolveRef({ fs, gitdir, ref })
                .then(sha => [ref, sha])),
            rx.reduce((map, e) => map.set(...e), imm.Map()),
            rx.catchError(() => imm.Map()),
        );
    }

    update (uuid) {
        this.changed.next([true, uuid]);
    }
}
