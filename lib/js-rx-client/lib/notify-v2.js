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

const { Response } = rxx;

function st_ok (res) {
    return res.status < 300;
}

class NotifyError extends Error {
    constructor (status, request) {
        super("Notify request failed");
        this.status = status;
        this.request = request;
    }
}

/** Provides access to the `notify/v2` API. */
export class NotifyV2 {
    /** Build a notify/v2 connection.
     *
     * @param service The ServiceInterface we should connect to.
     */
    constructor (service) {
        this.service = service;

        this.log = this.service.log;
        this.notify = this.build_notify();
    }

    /**
     * A sequence of WebSocket connections.
     * This property contains an Observable. While subscriptions to that
     * sequence exist it will maintain an open connection to the
     * `notify/v2` WebSocket endpoint on our service API.
     *
     * Each time a new WS is successfully opened, a pair `[send, msgs]`
     * will be sent down the sequence. `send` is a function which will
     * JSON-encode its argument and send it up the WS to the service.
     * `msgs` is another sequence, containing JSON-decoded messages from
     * the notify service.
     *
     * If the WS closes for any reason, the `msgs` sequence will end,
     * with an error if appropriate. The outer `notify` sequence will
     * not end, it will attempt to reconnect and, when successful, a new
     * pair will be sent down the outer sequence.
     *
     * Both inner and outer sequences are 'hot'. The outer sequence will
     * return immediately the current open WS, if any, on subscription.
     *
     * @name NotifyV2#notify
     */

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
    
    /** Make a request and return all the responses.
     * 
     * This accepts a request structure without the `uuid` key, and
     * returns an Observable. When that sequence is subscribed to the
     * request will be assigned a UUID and sent to the notify WS. Any
     * responses returned will be passed down the sequence.
     *
     * If our connection to the notify WS is lost, the request will be
     * re-sent (with a new UUID) once the connection is reestablished.
     * The new 'initial' responses can be identified by their 201
     * subscription status code.
     *
     * When the subscription is closed a CLOSE will be sent.
     *
     * @param req A notify request structure, without `uuid`.
     */
    request (req) {
        return rxx.rx(
            this.notify,
            rx.switchMap(([send, updates]) => {
                const uuid = uuidv4();
                return rxx.rx(
                    updates,
                    rx.filter(u => u.uuid == uuid),
                    rx.tap({
                        subscribe:      () => send({ ...req, uuid }),
                        unsubscribe:    () => send({ method: "CLOSE", uuid }),
                    }));
            }),
            rx.takeWhile(u => u.status != 410),
            rx.tap(u => st_ok(u) || this.log("Notify error: %s", u.status)),
            rx.mergeMap(u => st_ok(u) ? rx.of(u) 
                : rx.throwError(() => new NotifyError(u.status, req))));
    }

    /** Make a WATCH notify request and return a sequence of the HTTP
     * responses. Returns an Observable of Response objects.
     *
     * @param request An HTTP request structure.
     */
    watch_full (request) {
        if (typeof request == "string")
            request = { url: request };
        return rxx.rx(
            this.request({ method: "WATCH", request }),
            rx.map(u => Response.ofUpdate(u)));
    }

    /** Make a WATCH notify request and return a sequence of the
     * results. Returns an Observable of HTTP response bodies;
     * unsuccessful responses are all mapped to `null`.
     *
     * @param request An HTTP request structure.
     */
    watch (request) {
        return rxx.rx(
            this.watch_full(request),
            rx.map(r => r.ifOK(r => r)));
    }

    /** Make a SEARCH notify request and return a sequence of the HTTP
     * responses returned. Returns an Observable of Responses. Each new
     * Response indicates the search results have changed. Successful
     * Responses contain an immutable Map mapping from child path to a
     * Response for that child.
     *
     * @param parent The parent URL path to search from.
     * @param filter An object to filter the results.
     */
    search_full (parent, filter) {
        return rxx.rx(
            this.request({ method: "SEARCH", parent, filter }),
            rx.map(u => [u.child,
                Response.ofUpdate(u),
                Response.ofNullable(u.children)
                    .map(imm.Map)
                    .map(m => m.map(r => Response.of(r.status, r.body)))]),
            rx.scan((st, [child, res, children]) => child
                ? st.map(m => res.isEmpty ? m.delete(child) : m.set(child, res))
                : res.flatMap(r => children),
                Response.empty()));
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
                    .map(r => r.get()))
                .ifOK(rx.of, e => rx.EMPTY)));
    }
}
