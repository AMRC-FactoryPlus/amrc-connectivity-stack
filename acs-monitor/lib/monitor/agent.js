/*
 * ACS Monitor
 * Monitor class for ACS Edge Agents
 * Copyright 2024 AMRC
 */

import * as imm     from "immutable";
import * as rx      from "rxjs";

import { UUIDs }            from "@amrc-factoryplus/service-client";

import { App }              from "../uuids.js";
import { NodeMonitor }      from "./node.js";

/* How long to wait for the ConfigDB to answer a revision request */
const REVISION_TIMEOUT = 10000;

export class AgentMonitor extends NodeMonitor {
    revision_timeout = REVISION_TIMEOUT;

    async init () {
        await super.init();

        /* This will watch the ConfigDB Last_Changed metrics */
        this.cdb_watch = this.operator.cdb_watch;

        /* Watch our config entry in the CDB */
        this.config = this._init_config();

        /* Watch for changes to our config file. The log lines are
         * taps, not separate subscriptions: a second subscription
         * would run every revision check twice, outlive the monitor,
         * and have no error handler. */
        const config_changed = this._init_config_changed().pipe(
            rx.tap(() => this.log("Config changed for %s", this.node)));
        /* Watch for Secret changes we care about */
        const secret_changed = this._init_secret_changed().pipe(
            rx.tap(() => this.log("Secret changed for %s", this.node)));

        /* Check for updates to the config and send reload CMDs */
        this._checks.push(this._init_config_updates(
            config_changed, secret_changed));

        return this;
    }

    _init_config_updates (...srcs) {
        const cmdesc = this.fplus.CmdEsc;

        return rx.merge(...srcs).pipe(
            /* Fetch the current address */
            rx.withLatestFrom(this.device.address, (src, addr) => addr),
            /* Throttle restarts to once every 5s */
            rx.throttleTime(5000, undefined, { trailing: true }),
            /* Make a command escalation request. The Promise from
             * request_cmd will be converted to an Observable. */
            rx.switchMap(addr => cmdesc
                .request_cmd({
                    address:    addr,
                    name:       "Node Control/Reload Edge Agent Config",
                    type:       "Boolean",
                    value:      true,
                })
                /* Ensure that the address stays in the pipeline
                 * as the return result */
                .then(() => addr)),
            /* We only get here once the request has finished */
            rx.tap(addr => this.log("Sent reload request to %s", addr)),
        );
    }

    /* Track the Edge Agent's current config revision published over
     * MQTT, and the latest revision from the ConfigDB.
     */
    _init_config_changed () {
        /* Our EA's in-use config revision */
        const device = this.device.metric("Config_Revision").pipe(
            /* EA and ConfigDB use different representations here */
            rx.map(u => u == UUIDs.Null ? undefined : u),
            /* Every birth repeats the revision. Passing repeats on
             * would cancel a pending revision check below, so a stream
             * of births could hold off a genuine reload. */
            rx.distinctUntilChanged(),
            /* Keep the latest value available */
            rx.shareReplay(1),
        );

        /* Collect the most recent values from... */
        return rx.combineLatest({
            /* Our EA's in-use config revision */
            device,
            /* The ConfigDB's current config revision */
            config: this.config,
        }).pipe(
            /* If they match, we don't care. Otherwise check the
             * ConfigDB's live revision before reporting a change. Our
             * cached revision only moves when we see a Last_Changed
             * notification; if we miss one it stays wrong until we
             * restart, and every birth from the EA would look like a
             * config change. switchMap drops a pending check when a
             * new pair of values arrives. */
            rx.switchMap(up => up.device == up.config
                ? rx.EMPTY
                : this._check_config(up)),
            rx.filter(up => up.device != up.config),
        );
    }

    /* Ask the ConfigDB for the live revision. The answer also feeds
     * this.config, so a stale cached revision is corrected. Emits the
     * pair with the live revision, or nothing if the agent is up to
     * date. If the ConfigDB can't be reached, fall back to the cached
     * revision. We take the first answer to any request made after
     * ours: if a notification's request replaced ours, its answer is
     * at least as new. */
    _check_config (up) {
        return rx.merge(
            this._revisions.pipe(rx.take(1)),
            rx.defer(() => {
                this._check_requests.next();
                return rx.EMPTY;
            }),
        ).pipe(
            rx.mergeMap(r => {
                if (r.error) {
                    this.log("Can't check config revision for %s: %s",
                        this.node, r.error?.message ?? r.error);
                    return rx.of(up);
                }
                return r.etag == up.device ? rx.EMPTY
                    : rx.of({ ...up, config: r.etag });
            }),
        );
    }

    _get_config_etag () {
        return this.fplus.ConfigDB
            .get_config_etag(App.AgentConfig, this.node);
    }

    /* Track the current revision of our EA config in the ConfigDB. */
    /* XXX This is far from ideal. The only (working) interface
     * currently exposed by the CDB is Last_Changed/Application, which
     * means we have to check our node's config every time any config
     * changes. */
    _init_config () {
        /* Requests from _check_config */
        this._check_requests = new rx.Subject();

        /* Watch for changes to configs for the AgentConfig Application */
        const notified = this.cdb_watch.application(App.AgentConfig).pipe(
            /* Add an extra notification at the start so we get the
             * current value when we start up */
            rx.startWith(undefined),
            rx.map(() => false),
        );

        /* Every time there's a change, or a check is requested, fetch
         * the current config revision for our config. This does a HEAD
         * request which just gets the revision UUID. All requests go
         * through one switchMap, which says 'if a new request comes in
         * before the last is answered, abandon it and start the new
         * one'; so an older answer can never replace a newer one. A
         * failed notification request errors the sequence, which the
         * check restarts after a delay. A failed check request is
         * passed on for _check_config to handle. */
        this._revisions = rx.merge(
            notified,
            this._check_requests.pipe(rx.map(() => true)),
        ).pipe(
            rx.switchMap(check => rx.defer(() => this._get_config_etag()).pipe(
                rx.timeout({
                    first:  this.revision_timeout,
                    with:   () => rx.throwError(() => new Error(
                        `No answer in ${this.revision_timeout} ms`)),
                }),
                rx.map(etag => ({ etag })),
                rx.catchError(error => {
                    if (check) return rx.of({ error });
                    throw error;
                }),
            )),
            rx.share(),
        );

        return this._revisions.pipe(
            rx.filter(r => !r.error),
            rx.map(r => r.etag),
            /* Skip notifications that don't change our revision UUID */
            rx.distinctUntilChanged(),
        );
    }

    /* Emit whenever our Secrets change */
    _init_secret_changed () {
        return this.operator.secrets.pipe(
            /* Pull out the secrets we care about */
            rx.map(sss => sss
                .filter((v, k) => this.spec.secrets.has(k))),
            /* Don't bother until we have something to watch */
            rx.skipWhile(sss => sss.isEmpty()),
            /* Skip updates where secrets aren't synced yet */
            rx.filter(sss => sss.every(ss =>
                ss.synced && ss.observed == ss.generation)),
            /* Some updates won't change our secrets */
            rx.distinctUntilChanged(imm.is),
        );
    }
}
