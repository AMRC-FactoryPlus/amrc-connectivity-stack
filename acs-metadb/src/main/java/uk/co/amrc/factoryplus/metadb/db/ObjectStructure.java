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
import io.vavr.control.*;

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
        return db().listQuery(Q_listRanks)
            .map(s -> s.getLiteral("uuid").getString())
            .toJavaList();
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
    public JsonValue createObject (UUID classU, Option<UUID> uuid, Option<UUID> owner)
    {
        request().checkACL(
            uuid.isEmpty() ? Vocab.Perm.CreateObj : Vocab.Perm.CreateSpecificObj,
            classU);

        var classR = db().findObject(classU)
            .getOrElseThrow(() -> new SvcErr.Conflict("Primary class not found"));

        var obj = uuid
            .flatMap(db()::findObject)
            .peek(o -> updatePrimary(o, classR))
            .getOrElse(() -> createNewObject(classR, uuid));

        var ownerU = owner.getOrElse(request()::clientUUID);

        updateOwner(obj, ownerU);
        updateDeleted(obj, false);

        return db().appMapper()
            .generateConfig(Vocab.App.Registration, obj)
            .getOrElseThrow(() -> new RdfErr.CorruptRDF("Cannot find object registration"));
    }

    private Resource createNewObject (Resource classR, Option<UUID> objU)
    {
        /* This is an Upstream error even though we don't strictly have
         * an upstream here; the most likely cause is service-setup not
         * complete yet, so a retry is appropriate. */
        var clientR = db().findObject(request().clientUUID())
                .getOrElseThrow(() -> new SvcErr.Upstream("Cannot resolve client UUID"));

        var objR = objU
            .map(u -> db().createObject(classR, u))
            .getOrElse(() -> db().createObject(classR));

        /* It's much easier to just set the ownership to the client
         * here, even if we're about to change it. */
        db().derived().add(objR, Vocab.owner, clientR);
        return objR;
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

        var obj = db().findObjectOrError(uuid);
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

    /* XXX This assumes JSON schema validation has been performed. The
     * appropriate schema is installed by core.ttl but there are no
     * protections to prevent it from being removed or changed. */
    public void updateRegistration (Resource obj, JsonValue config)
    {
        var spec = (JsonObject)config;

        var primary = Try.of(() -> spec.getString("class"))
            .flatMap(Decoders::tryParseUUID)
            .orElse(() -> Try.failure(new SvcErr.BadInput("Invalid class UUID")))
            .mapTry(classU -> db().findObject(classU)
                .getOrElseThrow(() -> new SvcErr.Conflict("Primary class not found")))
            .get();
        var owner = Try.of(() -> spec.getString("owner"))
            .flatMap(Decoders::tryParseUUID)
            .getOrElseThrow(() -> new SvcErr.BadInput("Invalid owner UUID"));
        var deleted = Try.of(() -> spec.getBoolean("deleted"))
            .getOrElseThrow(() -> new SvcErr.BadInput("Invalid deleted flag"));

        checkRegInvariants(obj, spec);

        updatePrimary(obj, primary);
        updateOwner(obj, owner);
        updateDeleted(obj, deleted);
    }

    private void updateDeleted (Resource obj, boolean deleted)
    {
        var model = db().derived();
        model.removeAll(obj, Vocab.deleted, null);
        model.addLiteral(obj, Vocab.deleted, deleted);
    }

    private void checkRegInvariants (Resource obj, JsonObject spec)
    {
        Try.of(() -> spec.getBoolean("strict"))
            .orElse(() -> Try.failure(new SvcErr.BadInput("Invalid strict flag")))
            .filterTry(s -> s, () -> new SvcErr.BadInput("Objects must be strict"))
            .get();

        var specUuid = Try.of(() -> spec.getString("uuid"))
            .flatMap(Decoders::tryParseUUID)
            .getOrElseThrow(() -> new SvcErr.BadInput("Invalid object UUID"));

        var model = db().derived();

        /* XXX We have to look up the object UUID again here because
         * we've lost track of it. This is a syntactic error and returns
         * 422; it should not need to access the database. */
        var dbUuid = Util.single(model.listObjectsOfProperty(obj, Vocab.uuid))
            .map(l -> Util.decodeLiteral(l, UUID.class))
            .getOrElseThrow(() -> new RdfErr.CorruptRDF("Cannot find object UUID"));
        if (!specUuid.equals(dbUuid))
            throw new SvcErr.BadInput("UUIDs cannot be changed");

        /* This is a semantic error, it depends on the current rank, so
         * it returns 409. */
        var rank = db().findRank(obj);
        if (spec.getInt("rank") != rank) {
            log.info("Rank changes can only be made via dumps");
            throw new RdfErr.RankMismatch();
        }
    }

    private void updateOwner (Resource obj, UUID toU)
    {
        var model = db().derived();
        var client = request().clientUUID();

        var fromU = Util.single(model.listObjectsOfProperty(obj, Vocab.owner))
            .map(RDFNode::asResource)
            .flatMap(f -> Util.single(model.listObjectsOfProperty(f, Vocab.uuid)))
            .map(l -> Util.decodeLiteral(l, UUID.class))
            .getOrElse(Vocab.U_Unowned);

        if (toU.equals(fromU)) return;
    
        /* We must have TakeFrom the old owner and GiveTo the new owner.
         * Everyone implicitly has: TakeFrom Self; GiveTo Self, Unowned. */
        if (!fromU.equals(client))
            request().checkACL(Vocab.Perm.TakeFrom, fromU);
        if (!toU.equals(Vocab.U_Unowned) && !toU.equals(client))
            request().checkACL(Vocab.Perm.GiveTo, toU);

        model.removeAll(obj, Vocab.owner, null);
        Option.some(toU)
            .filter(u -> !u.equals(Vocab.U_Unowned))
            .map(u -> db().findObject(u)
                .getOrElseThrow(() -> new SvcErr.Conflict("Owner not found")))
            .peek(to -> model.add(obj, Vocab.owner, to));
    }

    private void updatePrimary (Resource obj, Resource classR)
    {
        var model = db().derived();

        /* This is a change from the JS implementation; here we require
         * the object to already be a member of the new primary class.
         * The ConfigDB will create a new direct membership if needed,
         * but will not remove it again if the primary class changes.
         * This is inconsistent and so has been changed. */
        if (!model.contains(obj, RDF.type, classR))
            throw new SvcErr.Conflict("Not a member of primary class");
        model.removeAll(obj, Vocab.primary, null);
        model.add(obj, Vocab.primary, classR);
    }

    public List<String> listRelation (boolean direct, UUID uuid, String relation)
    {
        var rel = Relation.of(relation);
        var graph = direct ? db().direct() : db().derived();

        request().checkACL(direct ? rel.readClass() : rel.writeClass(), uuid);

        var klass = db().findObjectOrError(uuid);
        return graph
            .listResourcesWithProperty(rel.prop(), klass)
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
        request().checkACL(direct ? rel.readClass() : rel.writeClass(), klass);

        var kres = db().findObjectOrError(klass);
        var ores = db().findObjectOrError(object);
        /* We cannot use methods on ores as this is always from the
         * direct graph. */
        return !graph.listStatements(ores, rel.prop(), kres)
            .toList()
            .isEmpty();
    }

    public void putRelation (UUID klass, String relation, UUID object)
    {
        var rel = Relation.of(relation);

        request().checkACL(rel.writeClass(), klass);
        request().checkACL(rel.writeObject(), object);

        var kres = db().findObjectOrError(klass);
        var ores = db().findObjectOrError(object);

        var krank = db().findRank(kres);
        var orank = db().findRank(ores);
        if (krank != orank + rel.offset())
            throw new RdfErr.RankMismatch();

        db().direct().add(ores, rel.prop(), kres);
    }

    public void delRelation (UUID klass, String relation, UUID object)
    {
        var rel = Relation.of(relation);

        request().checkACL(rel.writeClass(), klass);
        request().checkACL(rel.writeObject(), object);

        var kres = db().findObjectOrError(klass);
        var ores = db().findObjectOrError(object);
        db().direct().remove(ores, rel.prop(), kres);
    }
}
