/*
 * ACS Advanced Admin interface
 * Alerts viewer
 * Copyright 2024 AMRC
 */

import { h, render, createContext }                 from "preact";
import { useContext, useEffect, useRef, useState }  from "preact/hooks";
import { signal, effect, useSignal }                from "@preact/signals";
import htm          from "htm";

import * as rx      from "rxjs";       
import yaml         from "yaml";

import { ServiceClient, UUIDs }     from "@amrc-factoryplus/service-client";
import * as FactoryPlus             from "@amrc-factoryplus/service-client";

/* XXX hack */
window.AMRC_FactoryPlus_Alerts = FactoryPlus;

const html = htm.bind(h);

const FPClient = createContext(null);
const Data = createContext(null);

const date_format = new Intl.DateTimeFormat(
    "en-GB", { dateStyle: "medium", timeStyle: "long" });

function cmp (a, b) { return a < b ? -1 : a > b ? 1 : 0 }
function asc (f) { return (a, b) => cmp(f(a), f(b)) }
function desc (f) { return (a, b) => cmp(f(b), f(a)) }

function Alert (props) {
    const { alrt } = props;

    console.log("ALERT: %o", alrt);
    const links = alrt.links.map(l => html`
        <tr><th>${l.relation}:</><td>${l.target}</></>
    `);
    return html`
        <section class="alert">
            <h2>${alrt.type}</>
            <table>
                <tr><th>Raised by:</th><td>${alrt.device}</></>
                <tr><th>Since:</><td>${date_format.format(alrt.since)}</></>
                ${links}
            </>
        </>
    `;
}

function Alerts (props) {
    const fplus = useContext(FPClient).value;
    const alerts = useContext(Data).value;

    return alerts
        .toSorted(desc(v => v.since))
        .map(a => html`<${Alert} alrt=${a}/>`);
}    

function Login (props) {
    const { directory_url } = props;

    const fplus = useContext(FPClient);

    const username = useSignal("");
    const password = useSignal("");
    const message = useSignal("");

    const try_login = async () => {
        const fp = await new ServiceClient({
            directory_url,
            username:       username.value,
            password:       password.value,
            browser: true,
            verbose: "ALL,!token,!service",
        }).init();
        const rv = await fp.Directory.ping();
        if (!rv) {
            message.value = "Login failed";
            return;
        }
        console.log("FPLUS: %o", fp);
        fplus.value = fp;
    };

    return html`
        <p>Using Directory <tt>${directory_url}</tt><br/>
            <label>Username: <input type=text size=20 value=${username} 
                onInput=${e => username.value = e.currentTarget.value}
                /></label><br/>
            <label>Password: <input type=password size=20 value=${password} 
                onInput=${e => password.value = e.currentTarget.value}
            /></label><br/>
            <button onClick=${try_login}>Log in</button><br/>
            <b>${message}</b>
        </p>
    `;
}

function CheckLogin (props) {
    const { directory } = props;
    const fplus = useContext(FPClient);

    if (fplus.value == null)
        return html`<${Login} directory_url=${directory}/>`;
    else
        return html`<${Alerts}/>`;
}

async function fetch_alerts (fplus) {
    const res = await fplus.Directory.fetch({
        url:    "v1/alert/active",
        cache:  "reload",
    });
    if (res[0] != 200) return;
    
    const info = o => fplus.ConfigDB.get_config(UUIDs.App.Info, o);
    const name = o => info(o).then(v => v?.name);
    const addr = o => fplus.Directory
        .get_device_address(o)
        .then(a => a.toString());
    const link = u => fplus.Directory.fetch(`v1/link/${u}`)
        .then(([st, rv]) => st == 200 ? rv : null);
    const unknown = u => `Unknown (${u})`;
    const first = async (v, ...fs) => {
        for (const f of fs) {
            const rv = await f(v);
            if (rv != null) return rv;
        }
    };

    const rv = [];
    for (const alrt of res[1]) {
        const inf = await info(alrt.device);
        if (inf?.deleted) continue;

        const links = [];
        for (const uuid of alrt.links ?? []) {
            const l = await link(uuid);
            if (!l) continue;
            links.push({
                relation:   await first(l.relation, name, unknown),
                target:     await first(l.target, name, addr, unknown),
            });
        }
            
        rv.push({
            device:     await first(alrt.device, name, addr, unknown),
            type:       await first(alrt.type, name, unknown),
            since:      new Date(alrt.last_change),
            links,
        });
    }
    return rv;
}

function watch_alerts (fplus, alerts) {
    if (fplus == null) return;

    const from_dir = rx.defer(async () => {
        const spa = await fplus.MQTT.sparkplug_app();
        const inf = await fplus.Directory.get_service_info(
            UUIDs.Service.Directory);
        const dev = await spa.device({ device: inf.device });
        return dev.metric("Last_Changed/Alert_Type");
    }).pipe(rx.mergeAll());

    /* This does not currently work correctly, as if we refresh because
     * of a CDB notification the CDB fetches all get stale cached
     * responses. We need a better change-notify interface that allows
     * us to make appropriate 'reload' requests, or (better) provides
     * the information we need directly. Disabling the cache altogether
     * makes the app unacceptably slow (unsurprisingly). */
    //const from_cdb = rx.defer(async () => {
    //    const cdbw = await fplus.ConfigDB.watcher();
    //    return cdbw.application(UUIDs.App.Info);
    //}).pipe(rx.mergeAll());

    const sub = rx.merge(rx.timer(0, 5*60*1000), from_dir, /*from_cdb*/).pipe(
        rx.throttleTime(1000, undefined, { leading: true, trailing: true }),
        rx.switchMap(() => fetch_alerts(fplus)),
    ).subscribe(res => res && (alerts.value = res));

    return () => sub.unsubscribe();
}

export async function run (container, directory) {
    const fplus = signal(null);
    const alerts = signal([]);

    effect(() => window.FP_Client = fplus.value);
    effect(() => watch_alerts(fplus.value, alerts));

    render(html`
        <${FPClient.Provider} value=${fplus}>
            <${Data.Provider} value=${alerts}>
                <${CheckLogin} directory=${directory}/>
            </>
        </>
    `, container);
}
