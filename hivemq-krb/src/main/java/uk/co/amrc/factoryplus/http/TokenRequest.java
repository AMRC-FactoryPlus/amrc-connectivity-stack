/* Factory+ Java client library.
 * HTTP request for a token.
 * Copyright 2023 AMRC.
 */

package uk.co.amrc.factoryplus.http;

import java.net.*;
import java.util.Base64;
import java.util.regex.*;

import org.ietf.jgss.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.hc.client5.http.async.methods.SimpleHttpRequest;
import org.apache.hc.client5.http.async.methods.SimpleHttpResponse;
import org.apache.hc.core5.http.ProtocolException;

import io.reactivex.rxjava3.core.Single;

import uk.co.amrc.factoryplus.*;

class TokenRequest
{
    private static final Logger log = LoggerFactory.getLogger(TokenRequest.class);

    private static final Pattern negotiateAuth = Pattern.compile(
        "^Negotiate +([A-Za-z0-9+/]+)$");

    private URI server;
    private GSSContext ctx;

    public TokenRequest (URI server, GSSContext ctx)
    {
        this.server = server;
        this.ctx = ctx;
    }

    /* This method is blocking and stateful. This is unavoidable with
     * the GSSAPI. */
    public SimpleHttpRequest buildRequest ()
        throws GSSException
    {
        //FPThreadUtil.logId("getting gss token");
        /* blocking */
        var tok = ctx.initSecContext(new byte[0], 0, 0);
        var creds = Base64.getEncoder().encodeToString(tok);
        var uri = server.resolve("/token");

        //log.info("Making GSS token request to {}", uri);

        var req = new SimpleHttpRequest("POST", uri);
        req.setHeader("Authorization", "Negotiate " + creds);

        return req;
    }

    private static Single<JsonResponse> mkerr (String msg)
    {
        return Single.<JsonResponse>error(new Exception(msg));
    }

    public Single<JsonResponse> handleResponse (JsonResponse res)
        throws ProtocolException, GSSException
    {
        if (res.getCode() == 401)
            return mkerr("Server rejected GSSAPI auth");

        var optAuth = res.getHeader("WWW-Authenticate");
        if (optAuth.isEmpty())
            return mkerr("No GSS token from server");

        var matcher = negotiateAuth.matcher(optAuth.get());
        if (!matcher.matches())
            return mkerr("Bad GSS WWW-Auth response");

        var tok64 = matcher.group(1);
        var tok = Base64.getDecoder().decode(tok64);
        var out = ctx.initSecContext(tok, 0, tok.length);

        if (out != null)
            return mkerr("GSSAPI wants to send a second token");
        if (!ctx.isEstablished())
            return mkerr("Cannot establish server's identity");

        //log.info("Accepted GSS response from {}", ctx.getTargName());
        ctx.dispose();

        return Single.just(res);
    }
}
