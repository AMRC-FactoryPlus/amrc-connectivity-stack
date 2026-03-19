/*
 * Factory+ RDF store
 * ConfigDB v2/ API
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.api;

import java.io.StringReader;
import java.util.UUID;

import jakarta.inject.*;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;

import jakarta.json.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.metadb.db.*;

@Path("v2")
public class V2Objects {
    @Inject private RdfStore db;

    private static final Logger log = LoggerFactory.getLogger(V2Objects.class);

    @GET @Path("object")
    public JsonArray listObjects ()
    {
        var objs = db.objectStructure().listObjects();
        return Json.createArrayBuilder(objs).build();
    }


    private JsonArray listRelation (String graph, UUID uuid, String relation)
    {
        var members = db.objectStructure()
            .listRelation(graph, uuid, relation);

        return Json.createArrayBuilder(members).build();
    }

    @GET @Path("class/{class}/{relation}")
    public JsonArray listDerivedRelation (
        @PathParam("class") UUID uuid,
        @PathParam("relation") String relation)
    {
        return listRelation("derived", uuid, relation);
    }

    /* This duplication is a bug in the API design. If we had
     * graph/{graph}/class/… instead then we could just redispatch to a
     * graph-specific subresource. */
    @GET @Path("class/{class}/direct/{relation}")
    public JsonArray listDirectRelation (
        @PathParam("class") UUID uuid,
        @PathParam("relation") String relation)
    {
        return listRelation("direct", uuid, relation);
    }

    private Response testRelation (String graph, UUID klass, String relation, UUID object)
    {
        var rv = db.objectStructure()
            .testRelation(graph, klass, relation, object);

        return Response.status(rv ? 204 : 404).build();
    }

    @GET @Path("class/{class}/{relation}/{object}")
    public Response handleDerivedRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        return testRelation("derived", klass, relation, object);
    }

    @GET @Path("class/{class}/direct/{relation}/{object}")
    public Response handleDirectRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        return testRelation("direct", klass, relation, object);
    }

    @PUT @Path("class/{class}/direct/{relation}/{object}")
    public void putRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        db.objectStructure().putRelation(klass, relation, object);
    }

    @DELETE @Path("class/{class}/direct/{relation}/{object}")
    public void delRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        db.objectStructure().delRelation(klass, relation, object);
    }

}

