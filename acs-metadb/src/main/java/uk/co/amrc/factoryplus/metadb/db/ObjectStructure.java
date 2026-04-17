/*
 * Factory+ metadata database
 * Object structure request handler
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.List;
import java.util.Set;
import java.util.UUID;

import jakarta.json.*;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.update.*;
import org.apache.jena.vocabulary.*;

import io.vavr.collection.Iterator;
import io.vavr.control.Option;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.client.FPUuid;
import uk.co.amrc.factoryplus.service.*;

/* Methods in this class check permissions before taking action. In the
 * case of owner changes this will be a requirement as the permission
 * requirements depend on the existing data. */

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
    public record Relation (Property prop, int offset,
        UUID readClass, /*UUID readObj,*/ UUID writeClass, UUID writeObject)
    {
        public static Relation of (String relation) {
            switch (relation) {
                case "member":
                    return new Relation(RDF.type, 1, 
                        Vocab.Perm.ReadMembers, /*Vocab.Perm.ReadMemberships,*/
                        Vocab.Perm.WriteMembers, Vocab.Perm.WriteMemberships);
                case "subclass":
                    return new Relation(RDFS.subClassOf, 0,
                        Vocab.Perm.ReadSubclasses, /*Vocab.Perm.ReadSuperclasses,*/
                        Vocab.Perm.WriteSubclasses, Vocab.Perm.WriteSuperclasses);
                default:
                    throw new SvcErr.NotFound("No such relation");
            }
        }
    }

    private static final Set<Resource> IMMUTABLE = Set.of(
        Vocab.App.Application, Vocab.Special,
        Vocab.App.Registration, Vocab.App.ConfigSchema,
        Vocab.Wildcard, Vocab.Unowned);

    /* These could return UUIDs, but it seems silly. */
    public List<String> listObjects ()
    {
        request().checkACL(Vocab.Perm.ListObj, FPUuid.Null);
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
        request().checkACL(Vocab.Perm.ListObj, FPUuid.Null);
        var rs = db().selectQuery(Q_listRanks);
        return Iterator.ofAll(rs)
            .map(s -> s.getLiteral("uuid").getString())
            .toJavaList();
    }

    /* TXN */
    private FPObject setPrimaryClass (FPObject obj, Resource klass)
    {
        log.info("Set primary class: {}, {}", obj, klass);

        var orank = db().findRank(obj.node());
        var krank = db().findRank(klass);

        if (krank != orank + 1)
            throw new RdfErr.RankMismatch();

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
    public JsonValue createObject (UUID klass, Option<UUID> uuid)
    {
        request().checkACL(
            uuid.isEmpty() ? Vocab.Perm.CreateObj : Vocab.Perm.CreateSpecificObj,
            klass);

        var kres = db().findObjectOrError(klass).node();

        var obj = uuid
            .map(u -> db().findObject(u)
                .map(o -> { log.info("Found object {}", o); return o; })
                .map(o -> setPrimaryClass(o, kres))
                .getOrElse(() -> db().createObject(kres, u)))
            .getOrElse(() -> db().createObject(kres));

        return db().appMapper()
            .generateConfig(Vocab.App.Registration, obj.node())
            .getOrElseThrow(() -> new RdfErr.CorruptRDF("Cannot find object registration"));
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
        request().checkACL(Vocab.Perm.DeleteObj, uuid);

        var obj = db().findObjectOrError(uuid).node();
        log.info("Found node {}", obj);
        if (IMMUTABLE.contains(obj)) {
            log.info("Object {} is immutable", obj);
            throw new RdfErr.Immutable();
        }

        /* We only check for direct dependents. If we have no direct
         * dependents we should also have no indirect. This relies
         * on no use of rdfs:domain etc. to infer memberships. */
        var model = db().direct();
        if (model.contains(obj, Vocab.rank)) {
            log.info("Object {} is a rank class", obj);
            throw new RdfErr.Immutable();
        }

        /* This will also catch configs-of-app. If we want to return
         * UUIDs in the 409 we will need to handle these separately. */
        var members = model.listResourcesWithProperty(RDF.type, obj);
        if (members.hasNext()) {
            log.info("Object {} has members:", uuid);
            members.forEachRemaining(m -> log.info("  {}", m));
            throw new RdfErr.InUse();
        }

        var subclasses = model.listResourcesWithProperty(RDFS.subClassOf, obj);
        if (subclasses.hasNext()) {
            log.info("Object {} has subclasses:", uuid);
            subclasses.forEachRemaining(m -> log.info("  {}", m));
            throw new RdfErr.InUse();
        }

        db().runUpdate(U_deleteConfigs, "obj", obj);
        model.removeAll(obj, null, null);
    }

    public List<String> listRelation (boolean direct, UUID uuid, String relation)
    {
        var rel = Relation.of(relation);
        var graph = direct ? db().direct() : db().derived();

        request().checkACL(direct ? rel.readClass : rel.writeClass, uuid);

        var klass = db().findObjectOrError(uuid);
        return graph
            .listResourcesWithProperty(rel.prop(), klass.node())
            .mapWith(r -> r.getProperty(Vocab.uuid))
            .filterKeep(s -> s != null)
            .mapWith(s -> s.getString())
            .toList();
    }

    public boolean testRelation (boolean direct, UUID klass, String relation, UUID object)
    {
        var rel = Relation.of(relation);
        var graph = direct ? db().direct() : db().derived();

        /* We don't check the object permissions here because (a) there
         * are no readObject perms defined and (b) the information can
         * be derived from listRelation anyway so there's no point. */
        request().checkACL(direct ? rel.readClass : rel.writeClass, klass);

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

        request().checkACL(rel.writeClass, klass);
        request().checkACL(rel.writeObject, object);

        var kres = db().findObjectOrError(klass).node();
        var ores = db().findObjectOrError(object).node();

        var krank = db().findRank(kres);
        var orank = db().findRank(ores);
        if (krank != orank + rel.offset())
            throw new RdfErr.RankMismatch();

        db().direct().add(ores, rel.prop(), kres);
    }

    public void delRelation (UUID klass, String relation, UUID object)
    {
        var rel = Relation.of(relation);

        request().checkACL(rel.writeClass, klass);
        request().checkACL(rel.writeObject, object);

        var kres = db().findObjectOrError(klass).node();
        var ores = db().findObjectOrError(object).node();
        db().direct().remove(ores, rel.prop(), kres);
    }
}
