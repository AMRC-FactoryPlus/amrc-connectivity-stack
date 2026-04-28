/*
 * Factory+ RDF store
 * Service interface endpoints
 * Copyright 2026 University of Sheffield AMRC
 */

/* This implementation is just a stub for now to make the ServiceClient
 * work. Properly this wants moving into a WebAPI class in a service-api
 * module like in JS. */

package uk.co.amrc.factoryplus.webapi;

import jakarta.inject.Singleton;
import jakarta.json.*;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.providers.*;

@Path("")
public class WebAPI
{
    private static final Logger log = LoggerFactory.getLogger(WebAPI.class);

    @Context private PingResult pingResult;
    @Context private AuthProvider authProvider;
    @Context private SecurityContext auth;

    @GET @Path("ping")
    public JsonValue ping ()
    {
        return pingResult.toJson();
    }

    @POST @Path("token")
    public JsonValue token ()
    {
        /* We do not allow refreshing a token from a token. */
        if (auth.getAuthenticationScheme().equals("bearer"))
            throw new WebApplicationException(403);

        var upn = auth.getUserPrincipal().getName();
        var sess = authProvider.newSession(upn);
        log.info("New token for {}: {}...", upn, sess.token().substring(0, 5));
        
        return Json.createObjectBuilder()
            .add("token", sess.token())
            .add("expiry", sess.expiry().toEpochMilli())
            .build();
    }
}
