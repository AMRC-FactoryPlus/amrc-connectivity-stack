/*
 * Factory+ Service HTTP API
 * notify/v2 API implementation
 * Copyright 2024 University of Sheffield
 */

import deep_equal from "deep-equal";
import Optional from "optional-js";
import { pathToRegexp } from "path-to-regexp";
import rx from "rxjs";
import { v4 as uuidv4 } from "uuid";
import { WebSocketServer } from "ws";

import * as rxx from "@amrc-factoryplus/rx-util";

const Token_rx = /^Bearer ([A-Za-z0-9+/]+)$/;

class PathFilter {
    constructor (opts) {
        this.regex = pathToRegexp(opts.path);
        this.handler = opts.handler;
    }

    check_path (path) {
        return Optional.of(path)
            .map(p => this.regex.exec(p))
            .map(m => m.slice(1))
            .map(match => (...args) => this.handler(...args, ...match));
    }
}

export class WatchFilter extends PathFilter {
    constructor (opts) {
        super(opts);
        this.method = opts.method ?? "GET";
    }

    /* Check if this is a HEAD request and handle it. */
    head_req (req) {
        const head = req.method == "HEAD";
        return {
            ...req,
            method: (head ? null : req.method) ?? "GET",
            filter: head ? this.head_filter : s => s,
        };
    }

    /* Take a seq of updates and strip the response bodies. */
    head_filter (seq) {
        return seq.pipe(rx.map(update => {
            if (!update.response) return update;
            const response = { ...update.response };
            delete response.body;
            return { ...update, response };
        }));
    }

    handle (session, sub) {
        return Optional.of(sub)
            .filter(s => s.method == "WATCH")
            .map(s => this.head_req(s.request))
            .filter(r => r.method == this.method)
            .flatMap(req => this.check_path(req.url)
                .map(handle => req.filter(handle(session))))
            .orElse(undefined);
    }
}

export class SearchFilter extends PathFilter {
    handle (session, sub) {
        return Optional.of(sub)
            .filter(s => s.method == "SEARCH")
            .flatMap(s => this.check_path(s.parent))
            .map(h => h(session, sub.filter))
            .orElse(undefined);
    }
}

class Session {
    constructor (opts) {
        this.ws = opts.ws;
        this.notify = opts.notify;

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

    /* Read subscription requests from `requests` and return an
     * Observable of the updates to send to the client in response. */
    build_updates () {
        /* Separate the 'open sub' and 'close sub' requests. Any request
         * which isn't CLOSE opens a new sub. */
        const [closes, opens] = rx.partition(
            this.requests(),
            r => r.method == "CLOSE");

        /* Map the sequence of opens into the appropriate updates */
        return opens.pipe(
            rx.tap(r => this.log("New sub: %O", r)),
            /* For each open, build a seq of the updates we will respond
             * with. Merge the update seqs into our single output
             * seq; the client can unpick using the UUIDs. */
            rx.mergeMap(req => {
                const { uuid } = req;

                /* A seq which emits a single 410 update when we receive
                 * an explicit CLOSE request from the client. */
                const closed = closes.pipe(
                    rx.filter(cl => cl.uuid == uuid),
                    rx.tap(cl => this.log("Close for sub %s", uuid)),
                    rx.map(cl => ({ status: 410 })),
                );

                /* Build a seq pipeline. */
                return rxx.rx(
                    /* Ask the service to handle the req. */
                    this.subscription(req),
                    /* Drop identical updates. This avoids sending
                     * repeated 403 responses when the client doesn't
                     * have access. XXX This is a hack. */
                    rx.distinctUntilChanged(deep_equal),
                    /* Pull in any explicit close. */
                    rx.mergeWith(closed),
                    /* Catch errors and convert to 500. */
                    rx.catchError(e => {
                        this.log("Sub error: %s: %s", uuid, e);
                        return rx.of({ status: 500 });
                    }),
                    /* Stop this seq after we have responded with an
                     * error (including a 410 caused by the client). */
                    rx.takeWhile(res => res.status < 400, true),
                    /* Stamp the updates with the correct UUID. */
                    rx.map(res => ({ ...res, uuid })),
                    rx.finalize(() => this.log("Sub closed: %s", uuid)),
                );
            }));
    }

    /* Build our updates seq and post the results to the WS. */
    send_updates () {
        const { ws } = this;

        const sub = this.build_updates().subscribe({
            next: u => {
                const data = JSON.stringify(u, null, 2);
                //this.log("Notify %s", data);
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
        /* When the WS has closed, for whatever reason, tear down the
         * whole lot as we can't send any more messages. */
        ws.on("close", () => sub.unsubscribe());
    }

    validate_subscription (sub) {
        switch (sub.method) {
            case "WATCH":
                if (!sub.request) return false;
                return true;
            case "SEARCH":
                if (!sub.parent?.endsWith("/")) return false;
                return true;
        }
        return false;
    }

    subscription (sub) {
        const { uuid } = sub;

        const fail = status => rx.of({ uuid, status });

        if (!this.validate_subscription(sub))
            return fail(400);

        const seq = this.notify.find_handler(this, sub);
        if (!seq) return fail(404);

        return seq;
    }

    /* Read messages from our WS and parse them. */
    requests () {
        const { ws } = this;
        return rxx.rx(
            rx.fromEvent(ws, "message"),
            rx.map(m => JSON.parse(m.data)),
            //rx.tap(r => this.log("Client req: %o", r)),
            rx.map(r => {
                if (!r.uuid)
                    throw new Error("No UUID for subscription request");
                return r;
            }),
            /* This allows multiple subscriptions to this seq.
             * build_updates will subscribe multiple times. */
            rx.share(),
        );
    }
}

export class Notify {
    constructor (opts) {
        this.log = opts.log;
        this.api = opts.api;
        this.auth = opts.auth;

        this.handlers = this.build_handlers();
    }

    build_handlers () { throw new TypeError("Notify is abstract"); }

    find_handler (session, sub) {
        for (const h of this.handlers) {
            const seq = h.handle(session, sub);
            if (seq) return seq;
        }
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

