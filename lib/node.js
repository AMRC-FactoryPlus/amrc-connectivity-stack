/*
 * ACS Edge Monitor
 * Node monitor class
 * Copyright 2023 AMRC
 */

import util         from "util";

import imm          from "immutable";
import rx           from "rxjs";

import { Address, UUIDs }   from "@amrc-factoryplus/utilities";
import * as rxx             from "@amrc-factoryplus/rx-util";

import { Alert, App } from "./uuids.js";

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

        /* Read all packets from the Node, including Devices */
        this.all_pkts = this._init_all_pkts();

        /* Check for updates to the config file */
        this._checks.push(this._rebirth_if_silent());

        this.offline = this._init_offline();

        return this;
    }

    checks () {
        const reporter = this.operator.sparkplug;

            /* rx.from on the array gives us a seq-of-seqs */
        return rx.from(this._checks).pipe(
            /* Attach restart logic to each check seq */
            rx.map(ch => ch.pipe(
                rx.tap({ error: e => 
                    this.log("Check error: %s: %o", this.node, e) }),
                rx.retry({ delay: 5000 }),
            )),
            /* Flatten the seq-of-seqs into our output */
            rx.mergeAll(),
            /* Inform the Sparkplug Node */
            rx.tap({
                subscribe:  () => reporter.add_device(this),
                finalize:   () => reporter.remove_device(this),
            }),
        );
    }

    /* This is not quite the same as this.device.packets, as this
     * watches for packets from Devices as well. */
    _init_all_pkts () {
        const { device, app } = this;
        return device.address.pipe(
            rx.tap(addr => this.log("Watching all packets from %s", addr)),
            rx.switchMap(addr => rx.merge(
                app.watch_address(addr),
                app.watch_address(addr.child_device("+"))
                    .pipe(rx.tap(p => this.log("CHILD PACKET %s", addr))))),
            rx.tap({ error: e => this.log("Can't watch: %s", e) }),
            rx.retry({ delay: 10000 }),
            rx.share(),
        );
    }

    _rebirth_if_silent () {
        /* If we see no packets for 2 minutes, send a rebirth */
        return this.all_pkts.pipe(
            rx.timeout({ first: 30*1000, each: 2*60*1000 }),
            rx.retry({ delay: () => this.device.rebirth() }));
    }

    _init_offline () {
        /* If we see no packets for 5 minutes, raise an alert */
        return this.all_pkts.pipe(
            /* Pretend we saw an initial packet to give the device a
             * chance to speak */
            rx.startWith(null),
            rx.tap(p => this.log("PACKET from %s", this.node)),
            /* Each time we see a packet, restart this sub-seq */
            rx.switchMap(() => rx.merge(
                /* the offline alert goes inactive immediately */
                rx.of(false),
                /* but it goes active again after this delay */
                rx.of(true).pipe(rx.delay(5*60*1000)))),
            /* Always make a value available */
            rxx.shareLatest());
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
