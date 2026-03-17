/*
 * Factory+ RDF store
 * Config entry endpoints
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb;

import java.util.Date;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import jakarta.inject.*;
import jakarta.json.*;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.rdf.model.*;
import org.apache.jena.vocabulary.*;

import io.vavr.control.*;

@Path("v2/app/{app}/object/{object}")
@Consumes("application/json")
public class V2Config {
    private static final Logger log = LoggerFactory.getLogger(V2Config.class);

    @Inject                 RdfStore store;
    @PathParam("app")       UUID app;
    @PathParam("object")    UUID obj;

    private ConfigEntry configEntry ()
    {
        return store.configEntry(app, obj);
    }

    @GET 
    public Response get ()
    {
        log.info("Get config for {}/{}", app, obj);
        var entry = store.calculateRead(() -> {
            return configEntry().getValue();
        });
        return entry
            .map(e -> Response.ok(e.value())
                .tag(e.etag())
                .lastModified(Date.from(e.mtime()))
                .build())
            .orElseThrow(() -> new WebApplicationException(404));
    }

    /* XXX The default JsonValue entity parser will accept and silently
     * discard trailing rubbish after a valid JSON entity. It will also
     * cause 500 rather than 400 errors for invalid JSON. I think both
     * these could be fixed with a more careful Entity Provider. */
    @PUT 
    public void put (JsonValue config)
    {
        log.info("Put config for {}/{}", app, obj);
        store.executeWrite(() -> {
            configEntry().putValue(config);
        });
    }

    @DELETE
    public void delete ()
    {
        log.info("Delete config for {}/{}", app, obj);
        store.executeWrite(() -> {
            configEntry().removeValue();
        });
    }

    @PATCH @Consumes("application/merge-patch+json")
    public void mergePatch (JsonValue json)
    {
        var patch = Json.createMergePatch(json);
        store.executeWrite(() -> {
            var entry = configEntry();

            var o_conf = entry.getValue()
                .map(e -> e.value())
                .orElse(JsonValue.EMPTY_JSON_OBJECT);
            /* Safety: applying merge-patch to a non-object destroys the
             * whole thing. */
            if (!(o_conf instanceof JsonObject))
                throw new WebApplicationException(409);

            var n_conf = patch.apply(o_conf);
            entry.putValue(n_conf);
        });
    }
}
