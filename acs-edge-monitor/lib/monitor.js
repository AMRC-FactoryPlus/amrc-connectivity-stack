/*
 * ACS Edge Monitor
 * Node monitor class
 * Copyright 2023 AMRC
 */

import imm          from "immutable";
import duration     from "parse-duration";
import rx           from "rxjs";

import { UUIDs }            from "@amrc-factoryplus/utilities";
import * as rxx             from "@amrc-factoryplus/rx-util";

import { App }              from "./uuids.js";

export const NodeSpec = imm.Record({
    uuid:       null, 
    address:    null,
    edgeAgent:  false,
    interval:   "3m",
    secrets:    imm.Set(),
});
NodeSpec.of = spec => NodeSpec({
    ...spec,
    secrets:    imm.Set(spec.secrets ?? []),
});

export class NodeMonitor {
    constructor (op, spec) {
        this.operator = op;
        this.spec = spec;

        this.node = spec.uuid;
        this.interval = duration(spec.interval);

        this.fplus = op.fplus;

        this.log = this.fplus.debug.log.bind(this.fplus.debug, "node");

        this._checks = [];
    }

    static of (op, spec) {
        const Klass = spec.edgeAgent ? AgentMonitor : NodeMonitor;
        return new Klass(op, spec);
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

    address () {
        return rx.firstValueFrom(this.device.address);
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
                app.watch_address(addr.child_device("+")))),
            rx.tap({ error: e => this.log("Can't watch: %s", e) }),
            rx.retry({ delay: 10000 }),
            rx.share(),
        );
    }

    _rebirth_if_silent () {
        /* If we see no packets for our timeout interval, send a
         * rebirth. Delay the rebirth by up to half the interval again
         * to avoid rebirth storms. */

        const first = 5000;
        const each = this.interval;
        const jitter = each / 2;

        return this.all_pkts.pipe(
            rx.timeout({ first, each }),
            rx.retry({ 
                delay: () => 
                    rx.timer(Math.random() * jitter).pipe(
                        rx.mergeMap(() => this.device.rebirth()))
            }),
            rx.tap({ subscribe: () => 
                this.log("Liveness checks on %s with interval %s",
                    this.node, each) }));
    }

    _init_offline () {
        /* If we see no packets for 3 times our interval, raise an alert */

        const delay = this.interval * 3;

        return this.all_pkts.pipe(
            /* Pretend we saw an initial packet to give the device a
             * chance to speak */
            rx.startWith(null),
            /* Each time we see a packet, restart this sub-seq */
            rx.switchMap(() => rx.merge(
                /* the offline alert goes inactive immediately */
                rx.of(false),
                /* but it goes active again after this delay */
                rx.of(true).pipe(rx.delay(delay)))),
            /* Always make a value available */
            rxx.shareLatest());
    }
}

export class AgentMonitor extends NodeMonitor {
    async init () {
        await super.init();

        /* This will watch the ConfigDB Last_Changed metrics */
        this.cdb_watch = this.operator.cdb_watch;

        /* Watch our config entry in the CDB */
        this.config = this._init_config();

        /* Watch for changes to our config file */
        const config_changed = this._init_config_changed();
        config_changed.subscribe(v =>
            this.log("CONFIG CHANGED [%s]: %o", this.node, v));
        /* Watch for Secret changes we care about */
        const secret_changed = this._init_secret_changed();
        secret_changed.subscribe(v => 
            this.log("SECRET CHANGED [%s]: %o", this.node, v.toJS()));

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
            /* If they match, we don't care */
            rx.filter(up => up.device != up.config),
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
