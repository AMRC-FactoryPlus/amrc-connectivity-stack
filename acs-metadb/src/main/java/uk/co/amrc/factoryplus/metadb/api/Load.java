/*
 * Factory+ metadata database
 * Dump loading
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.api;

import java.util.UUID;

import jakarta.inject.*;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;

import jakarta.json.*;

import io.vavr.control.Option;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.metadb.db.*;

@Path("")
public class Load {
    @Inject private RdfStore db;
    @Inject private SecurityContext auth;

    private static final Logger log = LoggerFactory.getLogger(Load.class);

    @POST @Path("load")
    public void load (JsonValue dump)
    {
        log.info("Attempt to load dump {}", dump);
    }
}

