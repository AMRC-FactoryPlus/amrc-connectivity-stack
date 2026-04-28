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

import uk.co.amrc.factoryplus.client.FPAuth;
import uk.co.amrc.factoryplus.http.TextWebsocket;
import uk.co.amrc.factoryplus.util.*;

public class Session
{
    private static final Logger log = LoggerFactory.getLogger(Session.class);
    private static final Pattern Token_rx = 
        Pattern.compile("^Bearer ([A-Za-z0-9+/]+)$");

    private NotifyV2        notify;
    private FPAuth          auth;
    private UUID            uuid;

    /* These are initialised by start() */
    private String  upn;
    private boolean isRoot = false;

    public Session (NotifyV2 notify)
    {
        this.notify = notify;
        this.auth   = notify.auth().fplus().auth();
        this.uuid   = UUID.randomUUID();
    }

    public String upn () { return upn; }

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
                if (auth.isRoot(upn))
                    this.isRoot = true;
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

    private Observable<Response<Unit>> watchACL (UUID perm, UUID targ)
    {
        return auth.watchPermitted(this.upn, perm, targ)
            .map(res -> res
                .handle(st -> {
                    log.info("Error watching ACL: {}", st);
                    return Response.of(503);
                })
                .flatMap(ok -> ok ? Response.ok(Unit.UNIT) : Response.of(403)));
    }

    /** Apply ACLs to a notify sequence.
     * Returns a function which can be applied with .compose. This will
     * wrap the values from the source seq with Responses, or return 403
     * Responses whenever permission is not granted.
     */
    public <T> ObservableTransformer<T, Response<T>> applyACL (
        UUID permission, UUID target)
    {
        return src -> {
            log.info("Applying notify ACLs for {}", upn);

            var resps = src.map(Response::ok);

            /* For root requests we must not contact the Auth service. */
            if (isRoot) {
                log.info("Principal {} is root, skipping ACLs", upn);
                return resps;
            }

            return Observable.combineLatest(
                    resps, watchACL(permission, target),
                    (val, ok) -> ok.flatMap(u -> val))
                /* This stops extra 403s when permission is denied */
                .distinctUntilChanged();
        };
    }
}

