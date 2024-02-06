/*
 * ACS Edge Monitor
 * Node monitor class
 * Copyright 2023 AMRC
 */

import util         from "util";

import imm          from "immutable";
import rx           from "rxjs";

import { Address, UUIDs }   from "@amrc-factoryplus/utilities";

import { App } from "./uuids.js";

export class NodeMonitor {
    constructor (opts) {
        const op = this.operator = opts.operator;
        this.node = opts.node;

        this.fplus = op.fplus;

        this.log = this.fplus.debug.log.bind(this.fplus.debug, "node");

        this._checks = [];
    }

    async init () {
        /* This will watch a SP publisher and resolve aliases */
        this.app = await this.fplus.MQTT.sparkplug_app();

        /* This will track our Node by its ConfigDB address */
        this.device = this.app.device({ node: this.node });

        /* XXX Set up checks to watch for a birth */

        return this;
    }

    checks () {
        return rx.from(this.init()).pipe(
            /* Pull _checks out after init() resolves. Push the
             * sequences in the array into our output. We now have a
             * seq-of-seqs. */
            rx.mergeMap(th => th._checks),
            /* Attach restart logic to each check seq */
            rx.map(ch => ch.pipe(
                rx.tap({ error: e => 
                    this.log("Check error: %s: %o", this.node, e) }),
                rx.retry({ delay: 5000 }),
            )),
            /* Flatten the seq-of-seqs into our output */
            rx.mergeAll(),
        );
    }
}

export class AgentMonitor extends NodeMonitor {
    constructor (opts) {
        super(opts);
    }

    async init () {
        await super.init();

        /* This will watch the ConfigDB Last_Changed metrics */
        this.cdb_watch = this.operator.cdb_watch;

        /* Watch our config entry in the CDB */
        this.config = this._init_config();

        /* Check for updates to the config file */
        this._checks.push(this._init_config_updates());

        return this;
    }

    /* Track the Edge Agent's current config revision published over
     * MQTT, and the latest revision from the ConfigDB. If they don't
     * match, CMD the EA to reload its config file.
     */
    _init_config_updates () {
        const cmdesc = this.fplus.CmdEsc;

        /* Collect the most recent values from... */
        return rx.combineLatest({
            /* Our EA's Sparkplug address */
            address: this.device.address,
            /* Our EA's in-use config revision */
            device: this.device.metric("Config_Revision")
                .pipe(rx.shareReplay(1)),
            /* The ConfigDB's current config revision */
            config: this.config,
        }).pipe(
            /* EA and ConfigDB represent 'no config' differently */
            rx.map(up => ({ ...up,
                device: up.device == UUIDs.Null ? undefined : up.device,
            })),
            /* If they match, we don't care */
            rx.filter(up => up.device != up.config),
            /* Throttle restarts to once every 5s */
            rx.throttleTime(5000, undefined, { trailing: true }),
            rx.tap(up => this.log("Config update: %o", up)),
            /* We only want the address at this point */
            rx.map(up => up.address),
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

    /* Track the current revision of our EA config in the ConfigDB. */
    /* XXX This is far from ideal. The only (working) interface
     * currently exposed by the CDB is Last_Changed/Application, which
     * means we have to check our node's config every time any config
     * changes. */
    _init_config () {
        const cdb = this.fplus.ConfigDB;
        /* Watch for changes to configs for the AgentConfig Application */
        return this.cdb_watch.application(App.AgentConfig).pipe(
            /* Add an extra notification at the start so we get the
             * current value when we start up */
            rx.startWith(undefined),
            /* Every time there's a change, fetch the current config
             * revision for our config. This does a HEAD request which
             * just gets the revision UUID. switchMap says 'if a new
             * notification comes in before request is answered, abandon
             * the current request and start a new one'. */
            rx.switchMap(() => cdb.get_config_etag(App.AgentConfig, this.node)),
            /* Skip notifications that don't change our revision UUID */
            rx.distinctUntilChanged(),
        );
    }
}
