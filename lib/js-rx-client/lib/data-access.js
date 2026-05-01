/*
 * Factory+ Rx interface
 * Data Access notify
 * Copyright 2026 University of Sheffield
 */

import * as imm from "immutable";
import * as rx from "rxjs";

import { Interfaces, urljoin }  from "@amrc-factoryplus/service-client";
import * as rxx                 from "@amrc-factoryplus/rx-util";

import { NotifyV2 } from "./notify-v2.js";

/** Extended DataAccess interface class.
 * This supports all the methods from the base DataAccess service
 * interface as well as methods to access the notify API.
 */
export class DataAccess extends Interfaces.DataAccess {
    constructor(fplus){
        super(fplus);

        /** A NotifyV2 object for the DataAccess service.
         * @type NotifyV2 */
        this.notify = new NotifyV2(this);
    }

    /**
     * Watch Dataset uuids with READ_DATASET permission
     * @returns list of uuids
     */
    watch_metadata_uuids(){
        return this.notify.watch(`v1/metadata/`);
    }

}