/*
 * Factory+ NodeJS Utilities
 * ConfigDB service interface.
 * Copyright 2022 AMRC.
 *
 * This class is loaded dynamically by service/configdb.js to avoid a
 * required dependency on rxjs.
 */

import rx from "rxjs";

export class ConfigDBWatcher {
    constructor (configdb, device) {
        this.configdb = configdb;
        this.device = device;
    }

    /* For now this returns an Observable<undefined>. It would be much
     * more useful to return an Observable<UUID> identifying which
     * object has had its config entry changed but the ConfigDB MQTT
     * interface doesn't currently expose that information. */
    application (uuid) {
        this._app ??= this.device
            .metric("Last_Changed/Application")
            .pipe(rx.share());

        return this._app.pipe(
            rx.filter(u => u == uuid),
            rx.map(u => undefined));
    }

    watch_config (app, obj) {
        return this.application(app).pipe(
            rx.startWith(undefined),
            rx.switchMap(() => this.configdb.get_config(app, obj)),
        );
    }

    watch_search (app, query) {
        return this.application(app).pipe(
            rx.startWith(undefined),
            rx.switchMap(() => this.configdb.search({ app, query })),
        );
    }
}
