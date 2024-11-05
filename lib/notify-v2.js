/*
 * Factory+ Rx interface
 * notify/v2 interface
 * Copyright 2024 University of Sheffield
 */

import * as imm             from "immutable";
import { v4 as uuidv4 }     from "uuid";
import * as rx              from "rxjs";

import * as rxx             from "@amrc-factoryplus/rx-util";

import { Maybe }            from "./maybe.js";

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

    /** Make a WATCH notify request and return a sequence of the HTTP
     * responses. Returns an Observable of Maybe objects which, if
     * OK, contain HTTP responses.
     *
     * @param request An HTTP request structure
     */
    watch_full (request) {
        if (typeof request == "string")
            request = { url: request };
        return rxx.rx(
            this.request({ method: "WATCH", request }),
            rx.map(u => u.response),
            rx.map(Maybe.ofHttp));
    }

    /** Make a WATCH notify request and return a sequence of the
     * results. Returns an Observable of HTTP response bodies;
     * unsuccessful responses are all mapped to `null`.
     *
     * @param request An HTTP request structure
     */
    watch (request) {
        return rxx.rx(
            this.watch_full(request),
            rx.map(r => r.ifOK(r => r.body, e => null)));
    }

    /** Make a SEARCH notify request and return a sequence of the HTTP
     * responses returned. Returns an Observable of Maybes. Each new
     * Maybe indicates the search results have changed. Successful
     * Maybes contain an immutable Map mapping from child path to a
     * Maybe for that child.
     *
     * @param parent The parent URL path to search from.
     * @param filter An object to filter the results.
     */
    search_full (parent, filter) {
        return rxx.rx(
            this.request({ method: "SEARCH", parent, filter }),
            rx.map(u => [u.child,
                Maybe.ofHttp(u.response),
                Maybe.of(u.children)
                    .map(imm.Map)
                    .map(m => m.map(Maybe.ofHttp))]),
            rx.scan((st, [child, res, children]) => child
                ? st.map(m => res.isEmpty ? m.delete(child) : m.set(child, res))
                : res.flatMap(r => children),
                Maybe.empty()));
    } 

    /** Make a SEARCH notify request and return a sequence of the
     * response bodies. Returns an Observable of immutable Maps.
     * The Maps map from child path to the response body for that child.
     * Updates where the parent URL returns an error will be suppressed.
     * Children returning an error response will be omitted from the
     * Map.
     *
     * @param parent The parent URL path to search from.
     * @param filter An object to filter the results.
     */
    search (parent, filter) {
        return rxx.rx(
            this.search_full(parent, filter),
            rx.flatMap(res => res
                .map(kids => kids
                    .filter(r => r.isOK)
                    .map(r => r.get().body))
                .ifOK(rx.of, e => rx.EMPTY)));
    }
}
