/*
 * Factory+ Rx interface
 * notify/v2 interface
 * Copyright 2024 University of Sheffield
 */

import * as imm             from "immutable";
import { v4 as uuidv4 }     from "uuid";
import * as rx              from "rxjs";

import * as rxx             from "@amrc-factoryplus/rx-util";

function st_ok (res) {
    return res.status < 300;
}

export class NotifyV2 {
    constructor (service) {
        this.service = service;

        this.log = this.service.log;
        this.notify = this.build_notify();
    }

    handle_notify_ws (ws) {
        const error = rxx.rx(
            rx.fromEvent(ws, "error"),
            rx.tap(e => this.log("Notify WS error: %o", e)));
        const stopped = rx.merge(error, rx.fromEvent(ws, "close"));
        const msgs = rxx.rx(
            rx.fromEvent(ws, "message"),
            rx.map(m => JSON.parse(m.data)),
            rx.tap(v => this.log("Notify update: %o", v)),
            rx.share());
        const send = msg => {
            if (ws.readyState > ws.constructor.OPEN) {
                this.log("Ignoring send to closing WS");
                return;
            }
            this.log("Sending request %o", msg);
            ws.send(JSON.stringify(msg));
        };

        return rxx.rx(
            rx.merge(rx.of([send, msgs]), error),
            rx.finalize(() => {
                this.log("Closing notify WS");
                ws.close();
            }),
            rx.takeUntil(stopped));
    }

    build_notify () {
        return rxx.rx(
            rx.defer(() => this.service.websocket("notify/v2")),
            rx.catchError(e => {
                this.log("Notify WS connect error: %s", e);
                return rx.EMPTY;
            }),
            rx.flatMap(ws => this.handle_notify_ws(ws)),
            rx.endWith(null),
            rx.repeat({ delay: () => rx.timer(5000 + Math.random()*2000) }),
            rx.tap(v => this.log("Notify socket %s", v ? "open" : "closed")),
            rxx.shareLatest(),
            rx.filter(w => w));
    }
    
    /* This accepts a request structure, without a UUID. When the
     * returned seq is subscribed to, it generates a new UUID for the
     * request, sends the request, and returns a sequence of the
     * responses. */
    request (req) {
        return rxx.rx(
            this.notify,
            rx.switchMap(([send, updates]) => {
                const uuid = uuidv4();
                return rxx.rx(
                    updates,
                    rx.filter(u => u.uuid == uuid),
                    rx.tap(u => st_ok(u) || u.status == 410
                        || this.log("Notify error: %s", u.status)),
                    rx.takeWhile(st_ok),
                    rx.tap({
                        subscribe:      () => send({ ...req, uuid }),
                        unsubscribe:    () => send({ method: "CLOSE", uuid }),
                    }));
            }));
    }

    watch (request) {
        if (typeof request == "string")
            request = { url: request };
        return rxx.rx(
            this.request({ method: "WATCH", request }),
            rx.map(u => u.response),
            rx.map(res => {
                if (st_ok(res))
                    return res.body;
                if (res.status == 404)
                    return null;
                this.throw(`Error watching ${url}`, res.status);
            }));
    }

    search (parent, filter) {
        return rxx.rx(
            this.request({ method: "SEARCH", parent, filter }),
            rx.scan((m, u) => u.child 
                ? st_ok(u.response)
                    ? m.set(u.child, u.response.body)
                    : m.delete(u.child)
                : st_ok(u.response)
                    ? imm.Map(u.children).map(r => r.body)
                    : imm.Map(),
                imm.Map()));
    } 
}
