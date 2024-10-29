/*
 * ACS ConfigDB
 * Change-notify WS interface
 * Copyright 2024 University of Sheffield
 */

import deep_equal from "deep-equal";
import { pathToRegexp } from "path-to-regexp";
import rx from "rxjs";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";

import { Perm } from "./constants.js";
import * as rxu from "./rx-util.js";

const Token_rx = /^Bearer ([A-Za-z0-9+/]+)$/;

const Handlers = [];

function register_handler (path, handler) {
    Handlers.push([pathToRegexp(path), handler]);
}

function single_config (session, app, object) {
    const to_response = async upd => {
        session.log("Map update: %o", upd);
        const ok = await session.check_acl(Perm.Read_App, app, true);
        if (!ok)
            return { status: 403 };
        if (!upd?.config)
            return { status: 404 };
        const res = { status: 200, body: upd.config };
        if (upd.etag)
            res.headers = { etag: upd.etag };
        return res;
    };

    /* XXX Strictly there is a race condition here: the initial fetch
     * does not slot cleanly into the sequence of updates. This would be
     * difficult to fix. */
    return rx.concat(
        rxu.rx(
            session.model.config_get({ app, object }),
            rx.flatMap(to_response),
            rx.map(response => ({ status: 201, response }))),
        rxu.rx(
            session.model.updates,
            rx.filter(u => u.app == app && u.object == object),
            rx.flatMap(to_response),
            rx.map(response => ({ status: 200, response }))),
    );
}
register_handler("app/:app/object/:object", single_config);

class Session {
    constructor (opts) {
        this.ws = opts.ws;

        this.authn = opts.notify.api.auth;
        this.authz = opts.notify.auth;
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

        const princ = await this.authn.auth_bearer({ creds: creds[1] })
            .catch(e => { this.log(e); return null; });
        if (!princ)
            return fail("401", "WS auth failed");

        /* XXX authorise? */
        ws.send("200");
        this.log("WebSocket authenticated for %s", princ);
        return princ;
    }

    check_acl (...args) {
        if (!this.principal) {
            this.log("Checking ACL with no principal");
            return false;
        }
        return this.authz.check_acl(this.principal, ...args);
    }

    build_updates () {
        const [closes, opens] = rx.partition(
            this.requests(),
            r => r.method == "CLOSE");

        return opens.pipe(
            rx.tap(r => this.log("New sub: %O", r)),
            rx.flatMap(req => {
                const { uuid } = req;

                const closed = closes.pipe(
                    rx.filter(cl => cl.uuid == uuid),
                    rx.tap(cl => this.log("Close for sub %s", uuid)),
                    rx.map(cl => ({ status: 410 })),
                );

                return rxu.rx(
                    this.subscription(req),
                    rx.distinctUntilChanged(deep_equal),
                    rx.mergeWith(closed),
                    rx.catchError(e => {
                        this.log("Sub error: %s: %s", uuid, e);
                        return rx.of({ status: 500 });
                    }),
                    rx.takeWhile(res => res.status < 400, true),
                    rx.map(res => ({ ...res, uuid })),
                    rx.finalize(() => this.log("Sub closed: %s", uuid)),
                );
            }));
    }

    send_updates () {
        const { ws } = this;

        const sub = this.build_updates().subscribe({
            next: u => {
                const data = JSON.stringify(u, null, 2);
                this.log("Notify %s", data);
                ws.send(data);
            },
            complete: () => {
                this.log("Notify closed");
                ws.close();
            },
            error: e => {
                this.log("Notify error: %s", e);
                ws.close();
            },
        });
        ws.on("close", () => sub.unsubscribe());
    }

    subscription (sub) {
        const { uuid, request: req } = sub;

        const fail = status => rx.of({ uuid, status });

        if (sub.method != "WATCH" || !req)
            return fail(400);
        if (req.method && !/^GET$/i.test(req.method))
            return fail(404);

        for (const [rxp, handler] of Handlers) {
            const match = rxp.exec(req.url);
            if (!match) continue;
            return handler(this, ...match.slice(1));
        }
        return fail(404);
    }

    requests () {
        const { ws } = this;
        return rxu.rx(
            rx.fromEvent(ws, "message"),
            rx.map(m => JSON.parse(m.data)),
            rx.tap(r => this.log("Client req: %o", r)),
            rx.map(r => {
                if (!r.uuid)
                    throw new Error("No UUID for subscription request");
                return r;
            }),
            rx.share(),
        );
    }
}

export class Notify {
    constructor (opts) {
        this.log = opts.log;
        this.model = opts.model;
        this.api = opts.api;
        this.auth = opts.auth;
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
