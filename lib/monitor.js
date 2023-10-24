/*
 * ACS Edge Monitor
 * Monitor class
 * Copyright 2023 AMRC
 */

import rx from "rxjs";

import { Address, UUIDs } from "@amrc-factoryplus/utilities";

import { App } from "./uuids.js";

export class Monitor {
    constructor (opts) {
        this.fplus = opts.fplus;
        this.node = opts.node;

        this.log = this.fplus.debug.log.bind(this.fplus.debug, "monitor");
    }

    async init () {
        this.app = await this.fplus.MQTT.sparkplug_app();
        this.device = await this.app.device({ node: this.node });
        this.config = await this._init_config();

        this.config_update = rx.combineLatest({
            address: this.device.address,
            device: this.device.metric("Config_Revision"),
            config: this.config,
        }).pipe(
            rx.tap(v => this.log("Update? %o", v)),
            rx.map(up => ({ ...up,
                device: up.device == UUIDs.Null ? undefined : up.device,
            })),
            rx.filter(up => up.device != up.config),
        );

        return this;
    }

    /* XXX This is far from ideal. The only (working) interface
     * currently exposed by the CDB is Last_Changed/Application, which
     * means we have to check our node's config every time any config
     * changes. On top of that, we have to GET it, meaning we have
     * transferred the config file down that the Edge Agent is about to
     * fetch again. */
    async _init_config () {
        const cdb = this.fplus.ConfigDB;
        const watcher = await cdb.watcher();
        return watcher.application(App.AgentConfig).pipe(
            rx.startWith(undefined),
            rx.switchMap(() => 
                cdb.get_config_etag(App.AgentConfig, this.node)),
        );
    }

    run () {
        const cmdesc = this.fplus.CmdEsc;

        this.config_update.pipe(
            rx.throttleTime(5000, undefined, { trailing: true }),
            rx.tap(up => this.log("Config update: %o", up)),
            rx.map(up => up.address),
            rx.switchMap(addr => cmdesc.request_cmd({
                    address:    addr,
                    name:       "Node Control/Reload Edge Agent Config",
                    type:       "Boolean",
                    value:      true,
                }).then(() => addr)),
            rx.tap(addr => this.log("Send reload request to %s", addr)),
        ).subscribe();
    }
}
