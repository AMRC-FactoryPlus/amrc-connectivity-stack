/*
 * Factory+ RDF store
 * Service interface endpoints
 * Copyright 2026 University of Sheffield AMRC
 */

/* This implementation is just a stub for now to make the ServiceClient
 * work. Properly this wants moving into a WebAPI class in a service-api
 * module like in JS. */

package uk.co.amrc.factoryplus.rdfstore;

import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;

import jakarta.inject.Singleton;
import jakarta.json.*;
import jakarta.ws.rs.*;

@Singleton @Path("")
public class WebAPI
{
    public static final long sessionLength = 3*3600*1000;

    private JsonValue pingResult;
    private SecureRandom rng;
    private Base64.Encoder base64;

    public WebAPI ()
    {
        pingResult = Json.createObjectBuilder()
            .add("service", Vocab.U_RDFStore.toString())
            .add("version", "2.0.0")
            .build();
        rng = new SecureRandom();
        base64 = Base64.getEncoder();
    }

    @GET @Path("ping")
    public JsonValue ping ()
    {
        return pingResult;
    }

    @POST @Path("token")
    public JsonValue token ()
    {
        var token = new byte[66];
        rng.nextBytes(token);

        long expiry = Instant.now().toEpochMilli() + sessionLength;
        
        return Json.createObjectBuilder()
            .add("token", base64.encodeToString(token))
            .add("expiry", expiry)
            .build();
    }
}
