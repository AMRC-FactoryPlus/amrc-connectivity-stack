/*
 * ACS ConfigDB
 * Change-notify WS interface
 * Copyright 2024 University of Sheffield
 */

import { pathToRegexp } from "path-to-regexp";
import rx from "rxjs";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";

import * as rxu from "./rx-util.js";

const Token_rx = /^Bearer ([A-Za-z0-9+/]+)$/;

const Handlers = [];

function register_handler (path, handler) {
    Handlers.push([pathToRegexp(path), handler]);
}

function single_config (model, app, object) {
    return rx.concat(
        rxu.rx(
            model.config_get({ app, object }),
            rx.map(r => ({ status: 201, body: r.json })),
        ),
        rxu.rx(
            model.updates,
            rx.filter(u => u.app == app && u.object == object),
            rx.map(u => ({ status: 200, body: u.config })),
        ),
    );
}
register_handler("app/:app/object/:object", single_config);

class Session {
    constructor (opts) {
        this.ws = opts.ws;

        this.fpauth = opts.notify.api.auth;
        this.log = (m, ...a) => 
            opts.notify.log(`[%s] ${m}`, this.uuid, ...a);
        this.model = opts.notify.model;

        this.uuid = uuidv4();
    }

    async start () {
        this.log("New client");
        this.ws.addEventListener("close", () => this.log("Client closed"));

        this.principal = await this.auth();
        if (!this.principal) return;
        this.send_updates();
    }

    async auth () {
        const { ws } = this;

        const fail = (st, msg) => {
            this.log(msg);
            ws.send(st);
            ws.close();
            return null;
        };

        const msg = await new Promise((resolve, reject) => {
            ws.addEventListener("message", resolve, { once: true });
            ws.addEventListener("error", reject, { once: true });
        });

        if (typeof msg.data != "string")
            return fail("400", "Binary auth message");
        const creds = Token_rx.exec(msg.data);
        if (!creds)
            return fail("400", "Bad auth message");

        const princ = await this.fpauth.auth_bearer({ creds: creds[1] })
            .catch(e => { this.log(e); return null; });
        if (!princ)
            return fail("401", "WS auth failed");

        /* XXX authorise? */
        ws.send("200");
        this.log("WebSocket authenticated for %s", princ);
        return princ;
    }

    send_updates () {
        const { ws } = this;

        const [opens, closes] = rx.partition(
            this.requests(),
            r => r.type == "CLOSE");

        const updates = opens.pipe(
            rx.tap(r => this.log("New sub: %O", r)),
            rx.flatMap(req => {
                const closed = closes.pipe(
                    rx.filter(cl => cl.uuid == req.uuid),
                    rx.tap(cl => this.log("Close for sub %s", cl.uuid)),
                    rx.map(cl => ({ uuid: cl.uuid, status: 410 })),
                );

                return rxu.rx(
                    this.subscription(req),
                    rx.mergeWith(closed),
                    rx.takeWhile(res => res.status < 400, true),
                );
            }));

        const sub = updates.subscribe(u => {
            const data = JSON.stringify(u, null, 2);
            this.log("Notify %s", data);
            ws.send(data);
        });
        ws.on("close", () => sub.unsubscribe());
    }

    subscription (sub) {
        const { uuid, request: req } = sub;

        const fail = status => rx.of({ uuid, status });

        if (sub.type != "WATCH" || !req)
            return fail(400);
        if (req.method && !/^GET$/i.test(req.method))
            return fail(404);

        for (const [rxp, handler] of Handlers) {
            const match = rxp.exec(req.url);
            if (!match) continue;
            return handler(this.model, ...match.slice(1));
        }
        return fail(404);
    }

    requests () {
        const { ws } = this;
        return rxu.rx(
            rx.fromEvent(ws, "message"),
            rx.map(m => JSON.parse(m.data)),
            rx.map(r => {
                if (!r.uuid)
                    throw new Error("No UUID for subscription request");
                return r;
            }),
        );
    }
}

export class Notify {
    constructor (opts) {
        this.log = opts.log;
        this.model = opts.model;
        this.api = opts.api;
    }

    run () {
        this.wss = new WebSocketServer({ 
            server: this.api.http, 
            path:   "/notify/v2",
        });
        this.wss.on("connection", this.new_client.bind(this));
    }

    new_client (ws) {
        new Session({ notify: this, ws }).start();
    }
}
