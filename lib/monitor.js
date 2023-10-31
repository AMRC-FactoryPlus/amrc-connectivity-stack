/*
 * ACS Edge Monitor
 * Monitor class
 * Copyright 2023 AMRC
 */

import util         from "util";

import imm          from "immutable";
import rx           from "rxjs";
import k8s          from "@kubernetes/client-node";

import * as rxx             from "@amrc-factoryplus/rx-util";
import { Address, UUIDs }   from "@amrc-factoryplus/utilities";

import { App } from "./uuids.js";

const CRD = {
    group:      "factoryplus.app.amrc.co.uk",
    version:    "v1",
    plural:     "sparkplugnodes",
};

const SparkplugNode = imm.Record({ uuid: null, edgeAgent: false });

export class Monitor {
    constructor (opts) {
        this.fplus = opts.fplus;

        this.log = this.fplus.debug.log.bind(this.fplus.debug, "monitor");
    }

    async init () {
        /* This will watch a SP publisher and resolve aliases */
        this.app = await this.fplus.MQTT.sparkplug_app();
        /* This will watch the ConfigDB Last_Changed metrics */
        this.cdb_watch = await this.fplus.ConfigDB.watcher();

        const kc = this.kubeconfig = new k8s.KubeConfig();
        kc.loadFromDefault();
        this.namespace = kc.getContextObject(kc.currentContext).namespace;
        this.k8s_watch = new k8s.Watch(kc);

        this.nodes = this._init_nodes();

        return this;
    }

    run () {
        this.nodes.subscribe(ns => this.log("SP nodes: %o", ns.toJS()));
        //this.config_updates.subscribe();
    }

    /* Watch the SparkplugNode objects on the cluster. Publishes
     * Immutable.Maps of the current state. */
    _init_nodes () {
        const path = util.format("/apis/%s/%s/namespaces/%s/%s",
            CRD.group, CRD.version, this.namespace, CRD.plural);
        this.log("Watching %s", path);
        
        return rxx.k8s_watch({
            watch:  this.k8s_watch,
            path,
            errors: e => this.log("SP node watch error: %s", e),
            value:  obj => SparkplugNode(obj.spec),
        }).pipe(
            rx.map(ns => ns.toSet()),
        );
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
            device: this.device.metric("Config_Revision"),
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
