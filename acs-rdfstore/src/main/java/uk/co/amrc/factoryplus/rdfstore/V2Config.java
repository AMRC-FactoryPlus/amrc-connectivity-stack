/*
 * Factory+ RDF store
 * Config entry endpoints
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.rdfstore;

import java.io.StringReader;
import java.util.UUID;
import java.util.function.Supplier;

import jakarta.inject.*;
import jakarta.json.*;
import jakarta.ws.rs.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.rdf.model.*;
import org.apache.jena.vocabulary.*;

@Path("v2/app/{app}/object/{object}")
public class V2Config {
    private static final Logger log = LoggerFactory.getLogger(V2Config.class);

    @Inject                 RdfStore store;
    @PathParam("app")       UUID app;
    @PathParam("object")    UUID obj;

    private Property appP;
    private Resource objR;

    /* Must be called within a txn */
    private void resolveUUIDs ()
    {
        appP = store.findObjectOr404(app).as(Property.class);
        objR = store.findObjectOr404(obj);
    }

    @GET 
    public JsonValue get ()
    {
        log.info("Get config for {}/{}", app, obj);
        var vals = store.calculateRead(() -> {
            resolveUUIDs();

            /* We fetch from the derived graph */
            return store.derived()
                .listObjectsOfProperty(objR, appP)
                .toList();
        });

        if (vals.isEmpty())
            throw new WebApplicationException(404);
        if (vals.size() > 1)
            throw new CorruptionException("Duplicated config entries", app);

        var val = vals.get(0).asLiteral();
        if (val.getDatatype() != RDF.dtRDFJSON)
            throw new CorruptionException("Non-JSON config entry", app);

        return Json.createReader(
                new StringReader(val.getString()))
            .readValue();
    }

    @PUT 
    public void put (JsonValue config)
    {
        log.info("Put config for {}/{}", app, obj);
        store.executeWrite(() -> {
            resolveUUIDs();

            /* We store to the direct graph */
            var model = store.direct();
            var confL = model.createTypedLiteral(
                config.toString(), RDF.dtRDFJSON);

            model.removeAll(objR, appP, null);
            model.add(objR, appP, confL);
        });
    }
}
