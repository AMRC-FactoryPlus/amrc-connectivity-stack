/*
 * Factory+ Java service client
 * WebSocket requests
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.http;

import java.net.URI;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.reactivex.rxjava3.core.*;

import uk.co.amrc.factoryplus.client.FPServiceException;
import uk.co.amrc.factoryplus.util.Duplex;

class WsRequest implements ResolvableRequest<Duplex<String, String>>
{
    private static final Logger log = LoggerFactory.getLogger(WsRequest.class);

    private Predicate<String> VALID_STATUS 
        = Pattern.compile("[1-5][0-9][0-9]").asMatchPredicate();

    private UUID service;
    private String path;

    public WsRequest (UUID service, String path)
    {
        this.service = service;
        this.path = path;
    }

    public UUID getService () { return service; }

    public Resolved resolveWith (URI base, String token)
    {
        final var uri = base.resolve(this.path);
        return this.new Resolved(uri, base, token);
    }

    class Resolved implements PerformableRequest<Duplex<String, String>>
    {
        private URI uri;
        private URI base;
        private String token;

        public Resolved (URI uri, URI base, String token)
        {
            this.uri = uri;
            this.base = base;
            this.token = token;
        }

        public Single<Duplex<String, String>> perform (FPHttpClient client)
        {
            return client.textWebsocket(this.uri)
                .flatMap(raw -> {
                    log.info("Authenticating WS for {}", uri);
                    final var rv = raw.getReceiver()
                        .firstOrError()
                        .flatMap(status -> {
                            log.info("WS auth response: {}", status);

                            if (status.equals("200"))
                                return Single.just(raw);

                            if (status.equals("401"))
                                throw new BadToken(base, token);

                            final int code = VALID_STATUS.test(status)
                                ? Integer.parseInt(status)
                                : 0;

                            throw new FPServiceException(service, code,
                                "Failed to authenticate to WebSocket");
                        });

                    raw.getSender().onNext("Bearer " + token);
                    return rv;
                });
        }
    }
}
