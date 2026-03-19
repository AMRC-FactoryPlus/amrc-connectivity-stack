/*
 * Factory+ metadata database
 * Object structure request handler
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.List;
import java.util.UUID;

import org.apache.jena.rdf.model.*;
import org.apache.jena.vocabulary.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ObjectStructure extends RequestHandler
{
    private static final Logger log = LoggerFactory.getLogger(ObjectStructure.class);

    private ObjectStructure (RdfStore db)
    {
        super(db);
    }

    public static ObjectStructure create (RdfStore db)
    {
        return new ObjectStructure(db);
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

    private Model findGraph (String name)
    {
        switch (name) {
            case "direct":      return db.direct();
            case "derived":     return db.derived();
            default:            throw new Err.NotFound("No such graph");
        }
    }

    /* These could return UUIDs, but it seems silly. */
    public List<String> listObjects ()
    {
        return db.calculateRead(() ->
            db.derived()
                .listObjectsOfProperty(Vocab.uuid)
                .filterKeep(n -> n.isLiteral())
                .mapWith(o -> o.asLiteral().getString())
                .toList());
    }

    public List<String> listRelation (String gname, UUID uuid, String relation)
    {
        var graph = findGraph(gname);
        var rel = Relation.of(relation);

        return db.calculateRead(() -> {
            var klass = db.findObjectOrError(uuid);
            return graph
                .listResourcesWithProperty(rel.prop(), klass.node())
                .mapWith(r -> r.getProperty(Vocab.uuid))
                .filterKeep(s -> s != null)
                .mapWith(s -> s.getString())
                .toList();
        });
    }

    public boolean testRelation (String gname, UUID klass, String relation, UUID object)
    {
        var graph = findGraph(gname);
        var rel = Relation.of(relation);

        return db.calculateRead(() -> {
            var kres = db.findObjectOrError(klass).node();
            var ores = db.findObjectOrError(object).node();
            /* We cannot use methods on ores as this is always from the
             * direct graph. */
            return !graph.listStatements(ores, rel.prop(), kres)
                .toList()
                .isEmpty();
        });
    }

    public void putRelation (UUID klass, String relation, UUID object)
    {
        var rel = Relation.of(relation);
        db.executeWrite(() -> {
            var kres = db.findObjectOrError(klass).node();
            var ores = db.findObjectOrError(object).node();

            var krank = db.findRank(kres);
            var orank = db.findRank(ores);
            if (krank != orank + rel.offset())
                throw new Err.RankMismatch(object, klass);

            db.direct().add(ores, rel.prop(), kres);
        });
    }

    public void delRelation (UUID klass, String relation, UUID object)
    {
        var rel = Relation.of(relation);
        db.executeWrite(() -> {
            var kres = db.findObjectOrError(klass).node();
            var ores = db.findObjectOrError(object).node();
            db.direct().remove(ores, rel.prop(), kres);
        });
    }
}
