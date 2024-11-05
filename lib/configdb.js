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

    watch_config (app, obj) {
        return this.notify.watch(`v1/app/${app}/object/${obj}`);
    }

    watch_list (app) {
        return this.notify.watch(`v1/app/${app}/object/`);
    }

    search_app (app, filter) {
        return this.notify.search(`v1/app/${app}/object/`, filter);
    }
}
