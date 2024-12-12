/*
 * Factory+ Rx interface
 * ConfigDB notify
 * Copyright 2024 University of Sheffield
 */

import * as imm from "immutable";
import * as rx from "rxjs";

import { Interfaces }   from "@amrc-factoryplus/service-client";
import * as rxx         from "@amrc-factoryplus/rx-util";

import { NotifyV2 } from "./notify-v2.js";

/** Extended ConfigDB interface class.
 * This supports all the methods from the base ConfigDB service
 * interface as well as methods to access the notify API.
 */
export class ConfigDB extends Interfaces.ConfigDB {
    constructor (fplus) {
        super(fplus);

        /** A NotifyV2 object for the ConfigDB service.
         * @type NotifyV2 */
        this.notify = new NotifyV2(this);
    }

    /** Watch a particular config entry.
     * Returns an Observable. This emits a value every time the config
     * entry changes. The sequence will emit `null` when the entry is
     * inaccessible.
     * @param app An Application UUID.
     * @param obj An object UUID.
     */
    watch_config (app, obj) {
        return this.notify.watch(`v1/app/${app}/object/${obj}`);
    }

    /** Watch an endpoint returning a set.
     * @returns An immutable Set.
     * @param url The URL to watch.
     */
    _watch_set (url) {
        return rxx.rx(
            this.notify.watch(url),
            rx.map(imm.Set),
            rx.distinctUntilChanged(imm.is));
    }

    /** List the configs for an Application.
     * Returns an Observable. This emits an Array every time the set of
     * configs for this Application changes. If the Application is
     * inaccessible the sequence emits `null`.
     * @param app The Application to watch.
     */
    watch_list (app) {
        return this._watch_set(`v1/app/${app}/object/`);
    }

    /** Run a notify SEARCH query over an application.
     * Returns an Observable of immutable Maps. Each Map contains an
     * entry for every selected config under the chosen Application.
     * Whenever any selected config entry changes, the sequence will
     * emit a new complete Map.
     *
     * If the application does not exist, an empty Map will be emitted.
     * If we receive errors from the SEARCH operation, no new Maps will
     * be emitted.
     *
     * The filter is an object matched against the values of the configs
     * to limit those that are returned.
     *
     * @param app An Application UUID.
     * @param filter An object to filter the results against.
     */
    search_app (app, filter) {
        return this.notify.search(`v1/app/${app}/object/`, filter);
    }

    /** Watch the members of a class.
     * @param klass A class UUID.
     */
    watch_members (klass) {
        return this._watch_set(`v2/class/${klass}/member/`);
    }

    /** Watch the subclasses of a class.
     * @param klass A class UUID.
     */
    watch_subclasses (klass) {
        return this._watch_set(`v2/class/${klass}/subclass/`);
    }
}
