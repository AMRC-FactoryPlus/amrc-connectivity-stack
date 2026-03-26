/*
 * Factory+ metadata database
 * Authentication filter
 * Copyright 2026 University of Sheffield AMRC
 */

/* Currently this is a stub. It should use the GSS methods from the
 * ServiceClient to handle Basic and Negotiate auth. This class should
 * also be moved into a service-api package.
 */

package uk.co.amrc.factoryplus.metadb.api;

import java.util.Base64;
import java.util.regex.Pattern;

import jakarta.annotation.Priority;
import jakarta.ws.rs.*;
import jakarta.ws.rs.container.*;
import jakarta.ws.rs.core.*;
import jakarta.ws.rs.ext.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.metadb.db.AuthProvider;

@Provider @PreMatching @Priority(Priorities.AUTHENTICATION)
public class AuthFilter implements ContainerRequestFilter
{
    private static final Logger log = LoggerFactory.getLogger(AuthFilter.class);
    
    @Context private AuthProvider provider;

    private static final Pattern Auth_rx = Pattern.compile(
        "([A-Za-z]+) +([A-Za-z0-9._~+/=-]+)");

    private void fail (ContainerRequestContext req, String msg, Object... args)
    {
        req.abortWith(Response.status(401)
            .header("WWW-Authenticate", "Basic realm=\"Factory+\"")
            .build());
    }

    public void filter (ContainerRequestContext req)
    {
        var auth = req.getHeaderString("Authorization");

        var auth_m = Auth_rx.matcher(auth);
        if (!auth_m.matches()) {
            fail(req, "Bad Auth header: ", auth);
            return;
        }

        provider.authenticate(auth_m.group(1), auth_m.group(2))
            .ifPresentOrElse(req::setSecurityContext,
                () -> fail(req, "Authentication failed"));
    }
}
