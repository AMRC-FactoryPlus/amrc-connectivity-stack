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
     * @returns 
     */
    watch_metadata_list(){
        return this.notify.watch(`v2/metadata/`);
    }

    watch_single_metadata(uuid){
        return this.notify.watch(`v2/metadata/${uuid}`);
    }

    search_metadata(filter){
        return this.notify.search(`v2/metadata/`, filter);
    }

    watch_structure_list(){
        return this.notify.watch('v2/structure/');
    }

    watch_single_structure(uuid){
        return this.notify.watch(`v2/structure/${uuid}`);
    }

    search_structure(filter){
        return this.notify.search('v2/structure/', filter);
    }

    /**
     * Watch valid Dataset uuids with INCLUDE_IN_UNION permission, i.e.
     * those datasets that may be embedded as a Union component.
     * @returns
     */
    watch_union_sources_list(){
        return this.notify.watch(`v2/union-sources/`);
    }

    /**
     * Watch valid Dataset uuids with USE_FOR_SESSION permission, i.e.
     * those datasets that may be used as a Session source.
     * @returns
     */
    watch_session_sources_list(){
        return this.notify.watch(`v2/session-sources/`);
    }
}