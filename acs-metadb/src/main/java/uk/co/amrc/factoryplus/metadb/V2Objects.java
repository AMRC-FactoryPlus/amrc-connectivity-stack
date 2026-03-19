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
    @Inject private RdfStore db;

    private static final Logger log = LoggerFactory.getLogger(V2Objects.class);

    @GET @Path("object")
    public JsonArray listObjects ()
    {
        var objs = db.calculateRead(() ->
            db.derived()
                .listObjectsOfProperty(Vocab.uuid)
                .filterKeep(n -> n.isLiteral())
                .mapWith(o -> o.asLiteral().getValue())
                .toList());

        return Json.createArrayBuilder(objs).build();
    }

    private record Relation (Property prop, int offset)
    {
        public static Relation of (String relation)
        {
            switch (relation) {
                case "member":      return new Relation(RDF.type, 1);
                case "subclass":    return new Relation(RDFS.subClassOf, 0);
                default:            throw new Err.NotFound("No such relation");
            }
        }
    }

    private JsonArray listRelation (Model graph, UUID uuid, String relation)
    {
        var rel = Relation.of(relation);
        var members = db.calculateRead(() -> {
            var klass = db.findObjectOrError(uuid);
            return graph
                .listResourcesWithProperty(rel.prop(), klass.node())
                .mapWith(r -> r.getProperty(Vocab.uuid))
                .filterKeep(s -> s != null)
                .mapWith(s -> s.getString())
                .toList();
        });

        return Json.createArrayBuilder(members).build();
    }

    @GET @Path("class/{class}/{relation}")
    public JsonArray listDerivedRelation (
        @PathParam("class") UUID uuid,
        @PathParam("relation") String relation)
    {
        return listRelation(db.derived(), uuid, relation);
    }

    /* This duplication is a bug in the API design. If we had
     * graph/{graph}/class/… instead then we could just redispatch to a
     * graph-specific subresource. */
    @GET @Path("class/{class}/direct/{relation}")
    public JsonArray listDirectRelation (
        @PathParam("class") UUID uuid,
        @PathParam("relation") String relation)
    {
        return listRelation(db.direct(), uuid, relation);
    }

    private Response testRelation (Model graph, UUID klass, String relation, UUID object)
    {
        var rel = Relation.of(relation);
        var rv = db.calculateRead(() -> {
            var kres = db.findObjectOrError(klass).node();
            var ores = db.findObjectOrError(object).node();
            /* We cannot use methods on ores as this is always from the
             * direct graph. */
            return graph.listStatements(ores, rel.prop(), kres)
                .toList()
                .isEmpty();
        });

        return Response.status(rv ? 204 : 404).build();
    }

    @GET @Path("class/{class}/{relation}/{object}")
    public Response handleDerivedRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        return testRelation(db.derived(), klass, relation, object);
    }

    @GET @Path("class/{class}/direct/{relation}/{object}")
    public Response handleDirectRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        return testRelation(db.direct(), klass, relation, object);
    }

    @PUT @Path("class/{class}/direct/{relation}/{object}")
    public void putRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        var rel = Relation.of(relation);
        db.executeWrite(() -> {
            var kres = db.findObjectOrError(klass).node();
            var ores = db.findObjectOrError(object).node();

            var krank = db.findRank(kres);
            var orank = db.findRank(ores);
            if (krank != orank + rel.offset())
                throw new WebApplicationException(409);

            db.direct().add(ores, rel.prop(), kres);
        });
    }

    @DELETE @Path("class/{class}/direct/{relation}/{object}")
    public void delRelation (
        @PathParam("class") UUID klass,
        @PathParam("relation") String relation,
        @PathParam("object") UUID object)
    {
        var rel = Relation.of(relation);
        db.executeWrite(() -> {
            var kres = db.findObjectOrError(klass).node();
            var ores = db.findObjectOrError(object).node();
            db.direct().remove(ores, rel.prop(), kres);
        });
    }

}

