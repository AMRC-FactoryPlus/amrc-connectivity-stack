/*
 * Factory+ service api
 * notify/v2 client session
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import java.io.StringReader;
import java.util.UUID;
import java.util.regex.Pattern;

import jakarta.json.*;

import io.reactivex.rxjava3.core.*;

import io.vavr.control.Option;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.http.TextWebsocket;

public class Session
{
    private static final Logger log = LoggerFactory.getLogger(Session.class);
    private static final Pattern Token_rx = 
        Pattern.compile("^Bearer ([A-Za-z0-9+/]+)$");

    private NotifyV2        notify;
    private UUID            uuid;

    /* These are initialised by start() */
    private String                  upn;

    public Session (NotifyV2 notify)
    {
        this.notify = notify;
        this.uuid = UUID.randomUUID();
    }

    public Session start (TextWebsocket ws)
    {
        log("New client");

        var send = ws.getSender();
        handleAuth(ws) 
            .doFinally(() -> log("Client closed"))
            .compose(this::handleRequests)
            .subscribe(
                msg -> send.onNext(msg),
                err -> {
                    log("Notify error:", err);
                    send.onComplete();
                },
                () -> {
                    log("Notify closed");
                    send.onComplete();
                });

        return this;
    }

    private void log (String msg, Object... args)
    {
        log.atInfo()
            .addKeyValue("uuid", uuid)
            .log(msg, args);
    }

    private Observable<String> handleAuth (TextWebsocket ws)
    {
        var send = ws.getSender();
        var recv = ws.getReceiver();

        return recv.firstElement()
            .flatMapSingle(this::authenticateClient)
            .doOnSuccess(res -> {
                log("Auth result: {}", res.message());
                send.onNext(res.status());
                if (!res.upn.isDefined())
                    send.onComplete();
            })
            .flatMap(r -> r.upn().fold(Maybe::empty, Maybe::just))
            .flatMapObservable(upn -> {
                log("Authenticated client: {}", upn);
                /* XXX I don't really like this stateful behaviour but
                 * the only alternative is threading the UPN through the
                 * sequence and that's just messy. */
                this.upn = upn;
                return recv;
            });
    }

    private record AuthResponse (Option<String> upn, String status, String message)
    { }

    private Single<AuthResponse> authenticateClient (String msg)
    {
        log("Client auth: [{}]", msg);
        var matcher = Token_rx.matcher(msg);
        if (!matcher.matches())
            return Single.just(
                new AuthResponse(Option.none(), "400", "Bad auth message"));

        var tok = matcher.group(1);
        log("Token: {}", tok);

        return notify.auth()
            .bearerAuth(tok)
            .map(res -> new AuthResponse(Option.some(res.upn()), "200", "Auth OK"))
            .onErrorReturn(e -> new AuthResponse(Option.none(), "401", "Bad token"));
    }

    private static JsonValue readJson (String json)
    {
        var sr = new StringReader(json);
        var jr = Json.createReader(sr);

        try { return jr.readValue(); }
        finally { jr.close(); }
    }

    private Observable<String> handleRequests (Observable<String> msgs)
    {
        return msgs
            .map(Session::readJson)
            .doOnNext(v -> log("Client req: {}", v))
            .map(Request::fromJson)
            .publish(this::buildUpdates)
            .map(JsonValue::toString);
    }

    private Observable<JsonValue> buildUpdates (Observable<Request> reqs)
    {
        /* no partition() in RxJava :( */
        var opens = reqs.filter(r -> r.method() != Request.Method.CLOSE);
        var closes = reqs.filter(r -> r.method() == Request.Method.CLOSE);

        return opens
            .flatMap(req -> {
                var uuid = req.uuid();
                log("New sub: {}", req);

                /* A seq which emits a single 410 update when we receive
                 * an explicit CLOSE from the client. */
                var closed = closes
                    .filter(cl -> cl.uuid().equals(uuid))
                    .doOnNext(cl -> log("Close for sub {}", uuid))
                    .map(cl -> NotifyUpdate.empty(410));

                return subscription(req)
                    /* XXX this is a hack */
                    .distinctUntilChanged()
                    /* pull in the 410s from the closes sequence */
                    .mergeWith(closed)
                    .onErrorReturn(e -> {
                        log("Sub error [{}]:", uuid, e);
                        return NotifyUpdate.empty(500);
                    })
                    /* takeUntil emits the final value */
                    .takeUntil(upd -> !upd.ok())
                    .map(upd -> upd.toJson(uuid))
                    .doFinally(() -> log("Sub closed: {}", uuid));
            });
    }

    private Observable<NotifyUpdate> subscription (Request req)
    {
        if (!req.validate()) {
            log("Invalid request: {}", req);
            return Observable.just(NotifyUpdate.empty(400));
        }

        return notify.findHandler(this, req)
            .getOrElse(() -> Observable.just(NotifyUpdate.empty(404)));
    }
}

