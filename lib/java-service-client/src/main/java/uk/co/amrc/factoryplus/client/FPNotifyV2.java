/*
 * Factory+ Java service client
 * notify/v2 interface
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.client;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.reactivex.rxjava3.core.*;

import org.json.*;

import uk.co.amrc.factoryplus.http.FPHttpClient;
import uk.co.amrc.factoryplus.http.TextWebsocket;
import uk.co.amrc.factoryplus.util.Duplex;

public class FPNotifyV2
{
    private static final Logger log = LoggerFactory.getLogger(FPNotifyV2.class);

    public static class NotifyWs
        extends Duplex.Base<JSONObject, Map<String, Object>>
    {
        public NotifyWs (Observer<JSONObject> send, 
            Observable<Map<String, Object>> recv)
        {
            super(send, recv);
        }

        public static NotifyWs of (TextWebsocket ws)
        {
            return ws.map(
                NotifyWs::new,
                obj -> obj.toString(),
                json -> {
                    var obj = new JSONTokener(json).nextValue();
                    return ((JSONObject)obj).toMap();
                });
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
             * side to complete which shows the WS has closed. If we are
             * unsubscribed then close the sending side. */
            .flatMap(ws -> Observable.merge(
                    Observable.just(ws),
                    ws.getReceiver().ignoreElements().toObservable())
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
            .doOnNext(v -> log.info("Notify socket {}",
                v.isEmpty() ? "closed" : "open"))
            /* Share the seq, making the last value immediately
             * available, while we have subscribers, and then keep it
             * for 5s in case someone reconnects. */
            .replay(1).refCount(5, TimeUnit.SECONDS)
            /* Strip out the empty Optionals, this means we get the
             * current WS immediately if one is open and wait if not. */
            .mapOptional(o -> o);
    }

    public Observable<Map<String, Object>> request (Map<String, Object> req)
    {
        return this.notify
            .switchMap(ws -> {
                final var uuid = UUID.randomUUID().toString();
                return ws.getReceiver()
                    .filter(u -> u.get("uuid").equals(uuid))
                    .doOnSubscribe(d -> {
                        var obj = new JSONObject(req).put("uuid", uuid);
                        ws.getSender().onNext(obj);
                    })
                    .doFinally(() -> {
                        var obj = new JSONObject()
                            .put("method", "CLOSE")
                            .put("uuid", uuid);
                        ws.getSender().onNext(obj);
                    });
            })
            .takeWhile(u -> !u.get("status").equals(410));
    }
}
