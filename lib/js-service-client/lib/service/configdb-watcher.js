/*
 * Factory+ NodeJS Utilities
 * ConfigDB service interface.
 * Copyright 2022 AMRC.
 *
 * This class is loaded dynamically by service/configdb.js to avoid a
 * required dependency on rxjs.
 */

import * as rx from "rxjs";

/** Watch ConfigDB entries over Sparkplug.
 * This is a separate class from ConfigDB to avoid a required dependency
 * on `sparkplug-app` and `rxjs`.
 * @deprecated
 */
export class ConfigDBWatcher {
    /** Private. Construct via the ConfigDB interface. */
    constructor (configdb, device) {
        this.configdb = configdb;
        this.device = device;
    }

    /** Watch for changes to an application.
     * This returns an Rx sequence which emits `undefined` every time
     * an entry for the given application changes.
     * @arg uuid The application UUID
     * @returns An Observable<undefined>.
     */
    application (uuid) {
        this._app ??= this.device
            .metric("Last_Changed/Application")
            .pipe(rx.share());

        return this._app.pipe(
            rx.filter(u => u == uuid),
            rx.map(u => undefined));
    }

    /** Track a given config entry.
     * Every time a change is reported for the given app, re-fetch a
     * particular config entry and emit the result.
     * @arg app An application UUID
     * @arg obj An object UUID
     * @returns An Observable of config entry objects
     */
    watch_config (app, obj) {
        return this.application(app).pipe(
            rx.startWith(undefined),
            rx.switchMap(() => this.configdb.get_config(app, obj)),
        );
    }

    /** Track the results of a search operation
     * Every time a change is reported for the given app, re-run a
     * search with the given query and emit the results.
     * @arg app An application UUID
     * @arg query A query suitable for `ConfigDB.search`.
     * @returns An Observable of Arrays of UUIDs.
     */
    watch_search (app, query) {
        return this.application(app).pipe(
            rx.startWith(undefined),
            rx.switchMap(() => this.configdb.search({ app, query })),
        );
    }
}
