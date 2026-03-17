/*
 * Factory+ RDF store
 * ConfigDB v2/ API
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb;

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
public class V2Objects {
    @Inject private RdfStore store;

    private static final Logger log = LoggerFactory.getLogger(V2Objects.class);

    private JsonArray _list (Model model, UUID uuid, Property prop)
    {
        var members = store.calculateRead(() -> {
            var klass = store.findObjectOrError(uuid);
            return model
                .listResourcesWithProperty(prop, klass.node())
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
}

