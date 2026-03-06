/*
 * Factory+ RDF store
 * Config entry endpoints
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.rdfstore;

import java.io.StringReader;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

import jakarta.inject.*;
import jakarta.json.*;
import jakarta.ws.rs.*;

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

    private Property appP;
    private Resource objR;

    /* TXN */
    private void resolveUUIDs ()
    {
        appP = store.findObjectOr404(app).as(Property.class);
        objR = store.findObjectOr404(obj);
    }

    /* TXN UUIDs */
    private Optional<JsonValue> getConfig ()
    {
        /* We fetch from the derived graph */
        var entries = store.derived()
            .listObjectsOfProperty(objR, appP)
            .toList();

        if (entries.isEmpty())
            return Optional.empty();

        return Try.success(entries)
            .filter(l -> l.size() == 1,
                l -> new CorruptionException("Duplicated config entries", app))
            .map(l -> l.get(0).asLiteral())
            .filter(v -> v.getDatatype() == RDF.dtRDFJSON,
                v -> new CorruptionException("Non-JSON config entry", app))
            .flatMap(v -> Try.success(v.getString())
                .map(StringReader::new)
                .map(r -> Json.createReader(r).readValue())
                .recoverWith(e -> {
                    log.warn("JSON decode failed", e);
                    return Try.failure(new CorruptionException("Bad JSON", app));
                }))
            /* We can't use toJavaOptional here, we need to throw errors */
            .map(Optional::of)
            .get();
    }

    /* TXN UUIDs */
    private void putConfig (JsonValue config)
    {
        /* We store to the direct graph */
        var model = store.direct();
        var confL = model.createTypedLiteral(
            config.toString(), RDF.dtRDFJSON);

        model.removeAll(objR, appP, null);
        model.add(objR, appP, confL);
    }

    @GET 
    public JsonValue get ()
    {
        log.info("Get config for {}/{}", app, obj);
        var entry = store.calculateRead(() -> {
            resolveUUIDs();
            return getConfig();
        });
        return entry.orElseThrow(() -> new WebApplicationException(404));
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
            resolveUUIDs();
            putConfig(config);
        });
    }

    @DELETE
    public void delete ()
    {
        log.info("Delete config for {}/{}", app, obj);
        store.executeWrite(() -> {
            resolveUUIDs();
            store.direct().removeAll(objR, appP, null);
        });
    }

    @PATCH @Consumes("application/merge-patch+json")
    public void mergePatch (JsonValue json)
    {
        var patch = Json.createMergePatch(json);
        store.executeWrite(() -> {
            resolveUUIDs();
            var o_conf = getConfig()
                .orElse(JsonValue.EMPTY_JSON_OBJECT);
            /* Safety: applying merge-patch to a non-object destroys the
             * whole thing. */
            if (!(o_conf instanceof JsonObject))
                throw new WebApplicationException(409);

            var n_conf = patch.apply(o_conf);
            putConfig(n_conf);
        });
    }
}
