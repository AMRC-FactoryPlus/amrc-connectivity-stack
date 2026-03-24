/*
 * Factory+ metadata database
 * Object structure request handler
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import jakarta.json.*;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.update.*;
import org.apache.jena.vocabulary.*;

import io.vavr.collection.Iterator;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ObjectStructure extends RequestHandler.Component
{
    private static final Logger log = LoggerFactory.getLogger(ObjectStructure.class);

    private ObjectStructure (RequestHandler req)
    {
        super(req);
    }

    public static ObjectStructure create (RequestHandler req)
    {
        return new ObjectStructure(req);
    }

    /* XXX Ideally both of these switch statements would become
     * data-driven. Possibly an :apiName relation from the property? But
     * with only two valid cases it does not seem worth it for now. */
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

    private static final Set<Resource> IMMUTABLE = Set.of(
        Vocab.Application, Vocab.Special,
        Vocab.Registration, Vocab.ConfigSchema,
        Vocab.Wildcard, Vocab.Unowned);

    private Model findGraph (String name)
    {
        switch (name) {
            case "direct":      return db().direct();
            case "derived":     return db().derived();
            default:            throw new Err.NotFound("No such graph");
        }
    }

    /* These could return UUIDs, but it seems silly. */
    public List<String> listObjects ()
    {
        return db().derived()
            .listObjectsOfProperty(Vocab.uuid)
            .filterKeep(n -> n.isLiteral())
            .mapWith(o -> o.asLiteral().getString())
            .toList();
    }

    private static final Query Q_listRanks = Vocab.query("""
        select ?uuid
        where {
            ?obj <core/rank> ?rank;
                <core/uuid> ?uuid.
        }
        order by asc(?rank)
    """);

    public List<String> listRanks ()
    {
        var rs = db().selectQuery(Q_listRanks);
        return Iterator.ofAll(rs)
            .map(s -> s.getLiteral("uuid").getString())
            .toJavaList();
    }

    /* TXN */
    private FPObject updateRegistration (FPObject obj, Resource klass)
    {
        log.info("Update registration: {}, {}", obj, klass);

        var orank = db().findRank(obj.node());
        var krank = db().findRank(klass);

        if (krank != orank + 1)
            throw new Err.RankMismatch();

        var model = db().derived();
        model.removeAll(obj.node(), Vocab.primary, null);
        model.add(obj.node(), Vocab.primary, klass);
        if (!model.contains(obj.node(), RDF.type, klass))
            model.add(obj.node(), RDF.type, klass);

        return obj;
    }

    /* XXX The JS API is careful about returning 201 when the object was
     * created. The JS ServiceClient uses this to provide an 'exclusive
     * create' feature. However I have moved away from thinking this is
     * a good idea at all; in general UUIDs for ephemeral objects should
     * be system-allocated, and for well-known objects we never need
     * exclusive create. Returning 201 would be possible here, we have
     * the required information, but it would make a mess of the return
     * value of this method. The most sensible option would be to return
     * a Jakarta Response, which is a clear layer violation. */
    public JsonValue createObject (UUID klass, Optional<UUID> uuid)
    {
        var kres = db().findObjectOrError(klass).node();

        var obj = uuid
            .map(u -> db().findObject(u)
                .map(o -> { log.info("Found object {}", o); return o; })
                .map(o -> updateRegistration(o, kres))
                .orElseGet(() -> db().createObject(kres, u)))
            .orElseGet(() -> db().createObject(kres));

        return request().appUpdater()
            .generateConfig(Vocab.Registration, obj.node())
            .orElseThrow(() -> new Err.CorruptRDF("Cannot find object registration"));
    }

    private static UpdateRequest U_deleteConfigs = Vocab.update("""
        delete {
            ?entry ?p ?o.
        }
        where {
            ?entry <app/for> ?obj.
            ?entry ?p ?o.
        }
    """);

    public void deleteObject (UUID uuid)
    {
        log.info("Delete object {}", uuid);
        var obj = db().findObjectOrError(uuid).node();
        log.info("Found node {}", obj);
        if (IMMUTABLE.contains(obj)) {
            log.info("Object {} is immutable", obj);
            throw new Err.Immutable();
        }

        /* We only check for direct dependents. If we have no direct
         * dependents we should also have no indirect. This relies
         * on no use of rdfs:domain etc. to infer memberships. */
        var model = db().direct();

        /* This will also catch configs-of-app. If we want to return
         * UUIDs in the 409 we will need to handle these separately. */
        var members = model.listResourcesWithProperty(RDF.type, obj);
        if (members.hasNext()) {
            log.info("Object {} has members:", uuid);
            members.forEachRemaining(m -> log.info("  {}", m));
            throw new Err.InUse();
        }

        var subclasses = model.listResourcesWithProperty(RDFS.subClassOf, obj);
        if (subclasses.hasNext()) {
            log.info("Object {} has subclasses:", uuid);
            subclasses.forEachRemaining(m -> log.info("  {}", m));
            throw new Err.InUse();
        }

        db().runUpdate(U_deleteConfigs, "obj", obj);
        model.removeAll(obj, null, null);
    }

    public List<String> listRelation (String gname, UUID uuid, String relation)
    {
        var graph = findGraph(gname);
        var rel = Relation.of(relation);

        var klass = db().findObjectOrError(uuid);
        return graph
            .listResourcesWithProperty(rel.prop(), klass.node())
            .mapWith(r -> r.getProperty(Vocab.uuid))
            .filterKeep(s -> s != null)
            .mapWith(s -> s.getString())
            .toList();
    }

    public boolean testRelation (String gname, UUID klass, String relation, UUID object)
    {
        var graph = findGraph(gname);
        var rel = Relation.of(relation);

        var kres = db().findObjectOrError(klass).node();
        var ores = db().findObjectOrError(object).node();
        /* We cannot use methods on ores as this is always from the
         * direct graph. */
        return !graph.listStatements(ores, rel.prop(), kres)
            .toList()
            .isEmpty();
    }

    public void putRelation (UUID klass, String relation, UUID object)
    {
        var rel = Relation.of(relation);
        var kres = db().findObjectOrError(klass).node();
        var ores = db().findObjectOrError(object).node();

        var krank = db().findRank(kres);
        var orank = db().findRank(ores);
        if (krank != orank + rel.offset())
            throw new Err.RankMismatch();

        db().direct().add(ores, rel.prop(), kres);
    }

    public void delRelation (UUID klass, String relation, UUID object)
    {
        var rel = Relation.of(relation);
        var kres = db().findObjectOrError(klass).node();
        var ores = db().findObjectOrError(object).node();
        db().direct().remove(ores, rel.prop(), kres);
    }
}
