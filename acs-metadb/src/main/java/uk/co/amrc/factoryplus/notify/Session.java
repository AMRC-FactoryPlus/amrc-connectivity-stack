/*
 * Factory+ service api
 * notify/v2 client session
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import java.util.UUID;
import java.util.regex.Pattern;

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
    private TextWebsocket   ws;
    private UUID            uuid;
    private String          upn;

    public Session (NotifyV2 notify, TextWebsocket ws)
    {
        this.notify = notify;
        this.ws = ws;
        this.uuid = UUID.randomUUID();
    }

    public Session start ()
    {
        log("New client");
    
        ws.getReceiver().firstElement()
            .flatMapSingle(this::authenticateClient)
            .doOnSuccess(res -> {
                log("Auth result: {}", res.message());
                var send = ws.getSender();
                send.onNext(res.status());
                if (!res.upn.isDefined())
                    send.onComplete();
            })
            .flatMap(r -> Maybe.fromOptional(r.upn().toJavaOptional()))
            .doOnSuccess(upn -> {
                log("Authenticated client: {}", upn);
                /* XXX I don't really like this stateful behaviour but
                 * the only alternative is threading the UPN through the
                 * sequence and that's just messy. */
                this.upn = upn;
            })
            .flatMapObservable(r -> ws.getReceiver())
            .doFinally(() -> log("Client closed"))
            .subscribe(m -> log("WS RECV: {}", m));

        return this;
    }

    private void log (String msg, Object... args)
    {
        log.atInfo()
            .addKeyValue("uuid", uuid)
            .log(msg, args);
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

        return Single.just(
            new AuthResponse(Option.some("bob"), "200", "Auth ok"));
    }
}

