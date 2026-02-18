/*
 * Factory+ Java service client
 * notify/v2 interface
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.client;

import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.function.UnaryOperator;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.reactivex.rxjava3.core.*;

import io.vavr.Tuple2;
import io.vavr.collection.HashMap;
import io.vavr.collection.List;
import io.vavr.collection.Map;

import org.json.*;

import uk.co.amrc.factoryplus.http.FPHttpClient;
import uk.co.amrc.factoryplus.http.TextWebsocket;
import uk.co.amrc.factoryplus.util.Duplex;
import uk.co.amrc.factoryplus.util.Response;
import uk.co.amrc.factoryplus.util.UrlPath;

public class FPNotifyV2
{
    private static final Logger log = LoggerFactory.getLogger(FPNotifyV2.class);

    public static class NotifyWs
        extends Duplex.Base<JSONObject, FPNotifyUpdate>
    {
        public NotifyWs (Observer<JSONObject> send, Observable<FPNotifyUpdate> recv)
        {
            super(send, recv);
        }

        public static NotifyWs of (TextWebsocket ws)
        {
            return ws.map(NotifyWs::new, Object::toString, FPNotifyUpdate::ofJSON);
        }
    }

    private FPHttpClient http;
    private UUID service;
    private Observable<NotifyWs> notify;

    public FPNotifyV2 (FPServiceClient fplus, UUID service)
    {
        this.http = fplus.http();
        this.service = service;

        this.notify = this._build_notify();
    }

    // This might not be needed. If not NotifyWs doesn't neet to be public.
    public Observable<NotifyWs> getNotify () { return notify; }

    private Observable<NotifyWs> _build_notify ()
    {
        /* This gives us a new WebSocket every time we subscribe */
        final var ws_src = this.http.authWebsocket(this.service, "notify/v2");

        return Observable.fromSingle(ws_src)
            /* Send the WS down the seq, and then wait for the receive
             * side to complete which shows the WS has closed. */
            .flatMap(ws -> Observable.merge(
                    /* Errors are handled in the outer Observable */
                    Observable.just(ws.compose(TextWebsocket::new,
                        s -> s, r -> r.onErrorComplete())),
                    ws.getReceiver().ignoreElements().toObservable())
                /* When we are unsubscribed close the sending side. */
                .doOnDispose(() -> ws.getSender().onComplete()))
            /* Do JSON coding */
            .map(NotifyWs::of)
            .compose(this::handleDisconnection);
    }

    private Observable<NotifyWs> handleDisconnection (Observable<NotifyWs> obs)
    {
        return obs
            /* Emit an empty Optional once the WS has closed */
            .map(ws -> Optional.of(ws))
            .concatWith(Observable.just(Optional.empty()))
            /* Delay and reconnect when we lose the connection */
            .doOnError(e -> log.info("Notify WS error: {}", e))
            .onErrorComplete()
            .repeatWhen(stops -> stops
                .switchMap(stop -> Observable.timer(
                    5000 + (long)(2000*Math.random()), TimeUnit.MILLISECONDS)))
            .doOnNext(v -> log.info("Notify socket {}", v.isEmpty() ? "closed" : "open"))
            .doOnDispose(() -> log.info("Notify socket dropped"))
            /* Share the seq, making the last value immediately
             * available, while we have subscribers, and then keep it
             * for 5s in case someone reconnects. */
            .replay(1).refCount(5, TimeUnit.SECONDS)
            /* Strip out the empty Optionals, this means we get the
             * current WS immediately if one is open and wait if not. */
            .mapOptional(o -> o);
    }

    public Observable<FPNotifyUpdate> request (FPNotifyRequest req)
    {
        return this.notify
            .switchMap(ws -> {
                final var uuid = UUID.randomUUID();
                return ws.getReceiver()
                    .filter(u -> u.getUUID().equals(uuid))
                    .doOnSubscribe(d -> {
                        log.info("Notify request [{}]: {}", uuid, req);
                        ws.getSender().onNext(req.toJSONWithUUID(uuid));
                    })
                    .doFinally(() -> {
                        log.info("Notify close [{}]", uuid);
                        ws.getSender().onNext(FPNotifyRequest.close(uuid));
                    });
            })
            .takeWhile(u -> u.getStatus() != 410)
            .flatMap(u -> {
                if (u.isOK())
                    return Observable.just(u);
                var status = u.getStatus();
                log.info("Notify error: {}", status);
                return Observable.error(
                    new FPNotifyException(service, status, req));
            });
    }

    public Observable<Response<Object>> watchFull (FPNotifyRequest.Watch req)
    {
        return this.request(req)
            .map(u -> u.getContent().getJSONObject("response"))
            .map(Response::fromJSON);
    }

    public Observable<Optional<Object>> watch (String path)
    {
        return watchFull(FPNotifyRequest.watch(path))
            .map(Response::toOptional);
    }

    /* These generic types are ridiculous. What I really want is a type
     * alias for R<M<S,R<O>>> but Java can't do that. Trying to
     * implement a type alias with a subclass just gets really messy. */
    private static UnaryOperator<Response<Map<String, Response<Object>>>>
        handleSearchUpdate (FPNotifyUpdate update)
    {
        var json = update.getContent();
        var child = json.optString("child", null);
        var res = Response.fromJSON(json.getJSONObject("response"));

        /* We cannot use ifOK as we want to preserve error Responses */
        if (child != null)
            return st -> st.map(kids ->
                res.isEmpty() ? kids.remove(child) : kids.put(child, res));

        /* For a full update we ignore the parent body. Possibly the
         * protocol should have put the full map under .body
         * instead? We also ignore the existing state. */
        return st -> res
            .map(b -> json.getJSONObject("children"))
            .map(kids -> kids.keySet().stream()
                .map(key -> new Tuple2<>(key, key))
                .collect(HashMap.collector())
                .transform(Map::narrow)
                .mapValues(kids::getJSONObject)
                .mapValues(Response::fromJSON));
    }

    public Observable<Response<Map<String, Response<Object>>>> searchFull (
        FPNotifyRequest.Search req)
    {
        return this.request(req)
            .map(FPNotifyV2::handleSearchUpdate)
            .scan(Response.empty(), 
                (state, update) -> update.apply(state));
    }

    public Observable<Map<UUID, Object>> search (String path)
    {
        return this.searchFull(FPNotifyRequest.search(path))
            .flatMap(res -> res
                .map(kids -> kids
                    .flatMap((key, kres) -> kres
                        .map(b -> new Tuple2<>(key, b))
                        .toVavrList())
                    .mapKeys(UUID::fromString))
                .orItem(HashMap::empty)
                .ifOK(Observable::just, Observable::empty));
    }

    public Observable<Map<UUID, Object>> search (List<Object> parts)
    {
        return this.search(UrlPath.join(parts, true));
    }
}
