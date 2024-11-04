/*
 * Factory+ Rx interface
 * ConfigDB notify
 * Copyright 2024 University of Sheffield
 */

import * as rx      from "rxjs";

import {
    Interfaces, ServiceError, UUIDs
}                   from "@amrc-factoryplus/service-client";
import * as rxx     from "@amrc-factoryplus/rx-util";

import { NotifyV2 } from "./notify-v2.js";

export class ConfigDB extends Interfaces.ConfigDB {
    constructor (fplus) {
        super(fplus);

        this.notify = new NotifyV2(this);
    }

    watch_url (url) {
        return rxx.rx(
            this.notify.request({ method: "WATCH", request: { url } }),
            rx.map(u => u.response),
            rx.map(res => {
                if (res.status == 200 || res.status == 201)
                    return res.body;
                if (res.status == 404)
                    return null;
                this.throw(`Error watching ${url}`, res.status);
            }));
    }

    watch_config (app, obj) {
        return this.watch_url(`v1/app/${app}/object/${obj}`);
    }
}
