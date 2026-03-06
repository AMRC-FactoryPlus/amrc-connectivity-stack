/*
 * Factory+ RDF store
 * ConfigDB v2/ API
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.rdfstore;

import java.io.StringReader;
import java.util.UUID;

import jakarta.inject.*;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;

import jakarta.json.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.vocabulary.*;

import io.vavr.control.*;

@Path("v2")
public class ApiV2 {
    @Inject private RdfStore store;

    private static final Logger log = LoggerFactory.getLogger(ApiV2.class);

    private Resource findObject (UUID uuid)
    {
        return store.findObject(uuid)
            .orElseThrow(() -> new WebApplicationException(404));
    }

    private JsonArray _list (Model model, UUID uuid, Property prop)
    {
        var members = store.calculateRead(() -> {
            var klass = findObject(uuid);
            return model
                .listResourcesWithProperty(prop, klass)
                .mapWith(r -> r.getProperty(Vocab.uuid))
                .filterKeep(s -> s != null)
                .mapWith(s -> s.getString())
                .toList();
        });

        return Json.createArrayBuilder(members).build();
    }

    @GET @Path("object")
    public JsonArray listObjects ()
    {
        var objs = store.calculateRead(() ->
            store.derived()
                .listObjectsOfProperty(Vocab.uuid)
                .filterKeep(n -> n.isLiteral())
                .mapWith(o -> o.asLiteral().getValue())
                .toList());

        return Json.createArrayBuilder(objs).build();
    }

    @GET @Path("class/{class}/direct/member")
    public JsonArray listDirectMembers (@PathParam("class") UUID klass)
    {
        return _list(store.direct(), klass, RDF.type);
    }

    @GET @Path("class/{class}/member")
    public JsonArray listMembers (@PathParam("class") UUID klass)
    {
        return _list(store.derived(), klass, RDF.type);
    }

    @GET @Path("class/{class}/direct/subclass")
    public JsonArray listDirectSubclasses (@PathParam("class") UUID klass)
    {
        return _list(store.direct(), klass, RDFS.subClassOf);
    }

    @GET @Path("class/{class}/subclass")
    public JsonArray listSubclasses (@PathParam("class") UUID klass)
    {
        return _list(store.derived(), klass, RDFS.subClassOf);
    }

    @GET @Path("app/{app}/object/{object}")
    public JsonValue getEntry (@PathParam("app") UUID app, 
        @PathParam("object") UUID obj)
    {
        log.info("Get config for {}/{}", app, obj);
        var vals = store.calculateRead(() -> {
            var appP = findObject(app).as(Property.class);
            var objR = findObject(obj);

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
}

