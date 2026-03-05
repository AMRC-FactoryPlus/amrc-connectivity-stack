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
    @Inject private Dataset dataset;

    private static final Logger log = LoggerFactory.getLogger(ApiV2.class);

    @GET @Path("object")
    public JsonArray listObjects ()
    {
        var objs = dataset.calculateRead(() ->
            dataset.getDefaultModel()
                .listObjectsOfProperty(Vocab.uuid)
                .filterKeep(n -> n.isLiteral())
                .mapWith(o -> o.asLiteral().getValue())
                .toList());

        return Json.createArrayBuilder(objs).build();
    }

    /* Must be called within a txn */
    private Resource _findObject (Model model, UUID uuid)
    {
        var klasses = model
            .listResourcesWithProperty(Vocab.uuid, uuid.toString())
            .toList();
        if (klasses.isEmpty())
            throw new WebApplicationException(404);
        if (klasses.size() > 1)
            throw new CorruptionException("More than one candidate", uuid);
        
        var klass = klasses.get(0);
        if (!klass.isURIResource())
            throw new CorruptionException("UUID does not name a URI", uuid);

        return klass;
    }

    private JsonArray _list (Model model, UUID uuid, Property prop)
    {
        var members = dataset.calculateRead(() -> {
            var klass = _findObject(model, uuid);
            return model
                .listResourcesWithProperty(prop, klass)
                .mapWith(r -> r.getProperty(Vocab.uuid))
                .filterKeep(s -> s != null)
                .mapWith(s -> s.getString())
                .toList();
        });

        return Json.createArrayBuilder(members).build();
    }

    @GET @Path("class/{class}/direct/member")
    public JsonArray listDirectMembers (@PathParam("class") UUID klass)
    {
        return _list(dataset.getNamedModel(Vocab.G_direct), klass, RDF.type);
    }

    @GET @Path("class/{class}/member")
    public JsonArray listMembers (@PathParam("class") UUID klass)
    {
        return _list(dataset.getDefaultModel(), klass, RDF.type);
    }

    @GET @Path("class/{class}/direct/subclass")
    public JsonArray listDirectSubclasses (@PathParam("class") UUID klass)
    {
        return _list(dataset.getNamedModel(Vocab.G_direct), klass, RDFS.subClassOf);
    }

    @GET @Path("class/{class}/subclass")
    public JsonArray listSubclasses (@PathParam("class") UUID klass)
    {
        return _list(dataset.getDefaultModel(), klass, RDFS.subClassOf);
    }

    @GET @Path("app/{app}/object/{object}")
    public JsonValue getEntry (@PathParam("app") UUID app, 
        @PathParam("object") UUID obj)
    {
        var vals = dataset.calculateRead(() -> {
            var model = dataset.getDefaultModel();
            var appP = _findObject(model, app).as(Property.class);
            var objR = _findObject(model, obj);

            return model.listObjectsOfProperty(objR, appP)
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

