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
import uk.co.amrc.factoryplus.service.*;

@Path("v2")
public class V2Objects {
    @Inject private RdfStore db;
    @Inject private SecurityContext auth;

    private static final Logger log = LoggerFactory.getLogger(V2Objects.class);

    @GET @Path("object")
    public JsonArray listObjects ()
    {
        var objs = db.requestRead(auth, req ->
            req.objectStructure().listObjects());
        return Json.createArrayBuilder(objs).build();
    }

    private UUID jsonUUID (JsonValue val)
    {
        return Option.of(val)
            .filter(v -> v instanceof JsonString)
            .map(v -> ((JsonString)v).getString())
            .flatMap(Decoders::parseUUID)
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

        return db.requestWrite(auth, req ->
            req.objectStructure().createObject(klass, uuid));
    }

    @DELETE @Path("object/{object}")
    public void deleteObject (@PathParam("object") UUID uuid)
    {
        db.requestExecute(auth, req ->
            req.objectStructure().deleteObject(uuid));
    }

    @GET @Path("object/rank")
    public JsonArray listRanks ()
    {
        var ranks = db.requestRead(auth, req ->
            req.objectStructure().listRanks());
        return Json.createArrayBuilder(ranks).build();
    }

    private JsonArray listRelation (boolean direct, UUID uuid, String relation)
    {
        var members = db.requestRead(auth, req ->
            req.objectStructure()
                .listRelation(direct, uuid, relation));

        return Json.createArrayBuilder(members).build();
    }

    @GET @Path("class/{class}/{relation}")
    public JsonArray listDerivedRelation (
        @PathParam("class") UUID uuid,
        @PathParam("relation") String relation)
    {
        return listRelation(false, uuid, relation);
    }

    /* This duplication is a bug in the API design. If we had
     * graph/{graph}/class/… instead then we could just redispatch to a
     * graph-specific subresource. */
    @GET @Path("class/{class}/direct/{relation}")
    public JsonArray listDirectRelation (
        @PathParam("class") UUID uuid,
        @PathParam("relation") String relation)
    {
        return listRelation(true, uuid, relation);
    }

    private Response testRelation (boolean direct, UUID klass, String relation, UUID object)
    {
        var rv = db.requestRead(auth, req ->
            req.objectStructure()
                .testRelation(direct, klass, relation, object));

        return Response.status(rv ? 204 : 404).build();
    }

    @GET @Path("class/{class}/{relation}/{object}")
    public Response handleDerivedRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        return testRelation(false, klass, relation, object);
    }

    @GET @Path("class/{class}/direct/{relation}/{object}")
    public Response handleDirectRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        return testRelation(true, klass, relation, object);
    }

    @PUT @Path("class/{class}/direct/{relation}/{object}")
    public void putRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        db.requestExecute(auth, req ->
            req.objectStructure().putRelation(klass, relation, object));
    }

    @DELETE @Path("class/{class}/direct/{relation}/{object}")
    public void delRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        db.requestExecute(auth, req ->
            req.objectStructure().delRelation(klass, relation, object));
    }
}

