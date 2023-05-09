/* Factory+ Java client library.
 * HTTP request resolved wrt server and auth.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.http;

import java.net.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.hc.core5.http.ContentType;
import org.apache.hc.client5.http.async.methods.SimpleHttpRequest;
import org.apache.hc.client5.http.async.methods.SimpleHttpResponse;

import io.reactivex.rxjava3.core.Single;

class ResolvedRequest
{
    private static final Logger log = LoggerFactory.getLogger(ResolvedRequest.class);

    private FPHttpRequest source;
    private URI base;
    private String token;

    public ResolvedRequest (FPHttpRequest source, URI base, String token)
    {
        this.source = source;
        this.base = base;
        this.token = token;
    }

    public SimpleHttpRequest buildRequest ()
    {
        URI uri = base.resolve(source.path);

        //log.info("Making request {} {}", source.method, uri);
        var end = token.length() > 5 ? 5 : token.length();
        //log.info("Using bearer auth {}...", token.substring(0, end));

        var req = new SimpleHttpRequest(source.method, uri);
        req.setHeader("Authorization", "Bearer " + token);

        if (source.body != null)
            req.setBody(source.body.toString(), ContentType.APPLICATION_JSON);

        return req;
    }

    public Single<JsonResponse> handleResponse (JsonResponse res)
    {
        return res.getCode() == 401
            ? Single.error(() -> new BadToken(base, token))
            : Single.just(res);
    }
}
