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

import io.vavr.control.Option;

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
        var objs = db.requestRead(req ->
            req.objectStructure().listObjects());
        return Json.createArrayBuilder(objs).build();
    }

    private UUID jsonUUID (JsonValue val)
    {
        return Option.of(val)
            .filter(v -> v instanceof JsonString)
            .map(v -> ((JsonString)v).getString())
            .flatMap(Util::parseUUID)
            .getOrElseThrow(() -> new WebApplicationException(422));
    }

    @POST @Path("object")
    public JsonValue createObject (JsonObject spec)
    {
        var klass = jsonUUID(spec.get("class"));
        var uuid = Option.of(spec.get("uuid"))
            .filter(v -> !v.equals(JsonValue.NULL))
            .map(this::jsonUUID);

        log.info("Create object {}, {}", klass, uuid);

        /* We don't accept any other parameters. The ServiceClient
         * doesn't pass any anyway. */

        return db.requestWrite(req ->
            req.objectStructure().createObject(klass, uuid));
    }

    @DELETE @Path("object/{object}")
    public void deleteObject (@PathParam("object") UUID uuid)
    {
        db.requestExecute(req -> req.objectStructure().deleteObject(uuid));
    }

    @GET @Path("object/rank")
    public JsonArray listRanks ()
    {
        var ranks = db.requestRead(req -> req.objectStructure().listRanks());
        return Json.createArrayBuilder(ranks).build();
    }

    private JsonArray listRelation (String graph, UUID uuid, String relation)
    {
        var members = db.requestRead(req ->
            req.objectStructure()
                .listRelation(graph, uuid, relation));

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
        var rv = db.requestRead(req ->
            req.objectStructure()
                .testRelation(graph, klass, relation, object));

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
        db.requestExecute(req ->
            req.objectStructure().putRelation(klass, relation, object));
    }

    @DELETE @Path("class/{class}/direct/{relation}/{object}")
    public void delRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        db.requestExecute(req ->
            req.objectStructure().delRelation(klass, relation, object));
    }
}

