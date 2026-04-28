/*
 * Factory+ service API
 * Authentication filter
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.providers;

import java.nio.ByteBuffer;
import java.nio.charset.*;
import java.util.Base64;
import java.util.regex.Pattern;

import jakarta.annotation.Priority;
import jakarta.ws.rs.*;
import jakarta.ws.rs.container.*;
import jakarta.ws.rs.core.*;
import jakarta.ws.rs.ext.*;

import io.vavr.control.Option;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/* We have no facilities to support public URLs, without authentication.
 * Probably in WSRS these would need to be identified with annotations,
 * which might mean this filter needs to not be @PreMatching. Or
 * alternatively they could be provided by an initial match on the Jetty
 * side that doesn't load this filter? */

@Provider @Priority(Priorities.AUTHENTICATION)
public class AuthFilter implements ContainerRequestFilter, ContainerResponseFilter
{
    private static final Logger log = LoggerFactory.getLogger(AuthFilter.class);

    @Context private AuthProvider provider;

    /* This is the request filter. */
    public void filter (ContainerRequestContext req)
    {
        var auth = req.getHeaderString("Authorization");

        /* It is important this call blocks this thread, and throws any
         * exception coming from the Single. Otherwise the request
         * processing will continue before auth has been checked. */
        var ctx = provider.authenticate(auth)
            .doOnError(e -> log.info("Auth failed: {}", e.toString()))
            .blockingGet();

        req.setSecurityContext(ctx);
    }

    /* This is the response filter. */
    public void filter (ContainerRequestContext req, ContainerResponseContext res)
    {
        Option.of(req.getSecurityContext())
            .filter(r -> r instanceof FPSecurityContext)
            .flatMap(r -> ((FPSecurityContext)r).gssResult().gssToken())
            .map(provider.b64e()::encode)
            .map(StandardCharsets.US_ASCII::decode)
            .map(b64 -> "Negotiate " + b64)
            .peek(wwwa -> res.getHeaders().putSingle("WWW-Authenticate", wwwa));
    }
}
