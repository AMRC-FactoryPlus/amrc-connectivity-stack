/*
 * Factory+ metadata database
 * Bulk operations request handler
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;

import jakarta.json.*;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.update.*;
import org.apache.jena.vocabulary.*;

import io.vavr.Function3;
import io.vavr.collection.*;
import io.vavr.control.Option;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.client.FPUuid;
import uk.co.amrc.factoryplus.service.*;

/* Some methods in this class check permissions; some do not. */

public class BulkOperations extends RequestHandler.Component
{
    private static final Logger log = LoggerFactory.getLogger(BulkOperations.class);

    /* These must be loaded before other configs, as the affect
     * validation. Any RDF-mapping app will need to be added to this
     * list. */
    private static final Set<UUID> EARLY_APPS = HashSet.of(Vocab.App.U_ConfigSchema);

    record ObjSpec (
        UUID uuid,
        Resource iri,
        UUID primary,
        Option<String> name,
        Option<List<UUID>> memberOf,
        Option<List<UUID>> subclassOf,
        Option<UUID> powersetOf,
        Option<List<UUID>> enumMembers)
    {
        private static String jsonString (JsonValue v)
        {
            return ((JsonString)v).getString();
        }

        private static Option<List<UUID>> maybeUuidList (JsonObject spec, String key)
        {
            return Option.of(spec.get(key))
                .map(v -> Iterator.ofAll((JsonArray)v)
                    .map(ObjSpec::jsonString)
                    .map(Decoders::parseUUIDOrError)
                    .toList());
        }

        public static ObjSpec ofJson (String pri, String obj, JsonValue jval)
        {
            var uuid = Decoders.parseUUIDOrError(obj);
            var primary = Decoders.parseUUIDOrError(pri);
            var spec = (JsonObject)jval;

            var iri = Option.of(spec.get("iri"))
                .map(ObjSpec::jsonString)
                .map(Vocab::res)
                .getOrElse(() -> Vocab.uuidResource(uuid));
            var name = Option.of(spec.get("name"))
                .map(ObjSpec::jsonString);

            var memberOf = maybeUuidList(spec, "memberOf");
            var subclassOf =  maybeUuidList(spec, "subclassOf");
            var enumMembers = maybeUuidList(spec, "enum");

            var powersetOf = Option.of(spec.get("powersetOf"))
                .map(ObjSpec::jsonString)
                .map(Decoders::parseUUIDOrError);

            return new ObjSpec(uuid, iri, primary, name,
                memberOf, subclassOf, powersetOf, enumMembers);
        }
    }

    record ConfSpec (UUID app, UUID obj, JsonValue value)
    {
        public static ConfSpec ofJson (String app, String obj, JsonValue value)
        {
            var appU = Decoders.parseUUIDOrError(app);
            var objU = Decoders.parseUUIDOrError(obj);

            return new ConfSpec(appU, objU, value);
        }
    }

    private BulkOperations (RequestHandler req)
    {
        super(req);
    }

    public static BulkOperations create (RequestHandler req)
    {
        return new BulkOperations(req);
    }

    public void loadDump (JsonValue jval)
    {
        if (!db().schemaTracker().validateDump(jval))
            throw new SvcErr.BadInput("Invalid dump");
        log.info("Dump validated");

        var dump = (JsonObject)jval;
        try {
            Option.of(dump.get("objects"))
                .map(objs -> twoLevels(objs, ObjSpec::ofJson))
                .peek(this::loadObjects);
        }
        catch (Throwable e) {
            log.warn("Error loading objects: {}", e.toString());
            throw new SvcErr.BadInput("Dump violates class system constraints")
                .initCause(e);
        }

        try {
            Option.of(dump.get("configs"))
                .map(confs -> twoLevels(confs, ConfSpec::ofJson))
                .peek(this::loadConfigs);
        }
        catch (Throwable e) {
            log.warn("Error loading configs: {}", e.toString());
            throw new SvcErr.BadInput("Dump contains invalid configs")
                .initCause(e);
        }
    }

    private static Iterator<java.util.Map.Entry<String, JsonValue>>
        jsonEntries (JsonValue obj)
    {
        return Iterator.ofAll(
            ((JsonObject)obj).entrySet());
    }

    private static <T> List<T> twoLevels (JsonValue obj,
        Function3<String, String, JsonValue, T> factory)
    {
        return jsonEntries(obj)
            .flatMap(e1 -> jsonEntries(e1.getValue())
                .map(e2 -> factory.apply(
                    e1.getKey(), e2.getKey(), e2.getValue())))
            .toList();
    }

    private void loadObjects (List<ObjSpec> objs)
    {
        /* Create all objects first. */
        for (var o: objs)
            createObject(o);
        /* Now, if we fail to find a UUID, it is an error. */
        for (var o: objs)
            setRelations(o);

        db().derived().rebind();
        setRankSuperclasses();
        db().validateZFC();
    }

    private void createObject (ObjSpec o)
    {
        var model = db().direct();

        /* This will cause a validation error if we have duplicate
         * IRIs or UUIDs. This means it isn't possible to change the
         * IRI-UUID mapping from a dump. This could be changed in
         * future but it's not simple to see what to do. */
        model.add(o.iri(), Vocab.uuid, Vocab.uuidLiteral(o.uuid()));
        model.removeAll(o.iri(), Vocab.deleted, null);
        model.removeAll(o.iri(), Vocab.name, null);
        o.name().peek(n -> model.add(o.iri(), Vocab.name, n));
    }

    private void setRelations (ObjSpec o)
    {
        var model = db().direct();

        var priR = db().findObjectOrError(o.primary());
        model.removeAll(o.iri(), Vocab.primary, null);
        model.add(o.iri(), Vocab.primary, priR);

        model.removeAll(o.iri(), RDF.type, null);
        o.memberOf()
            .map(cs -> cs.map(db()::findObjectOrError))
            .getOrElse(() -> List.of(priR))
            .forEach(c -> model.add(o.iri(), RDF.type, c));

        model.removeAll(o.iri(), RDFS.subClassOf, null);
        o.subclassOf()
            .map(cs -> cs.map(db()::findObjectOrError))
            /* We must set the default rank subclasses later, after
             * we've rebound the derived graph. Otherwise we can't
             * find the ranks. */
            .getOrElse(() -> List.empty())
            .forEach(c -> model.add(o.iri(), RDFS.subClassOf, c));

        o.enumMembers().peek(ms -> {
            model.removeAll(null, RDF.type, o.iri());
            ms.map(db()::findObjectOrError)
                .forEach(m -> model.add(m, RDF.type, o.iri()));
        });

        model.removeAll(o.iri(), Vocab.powersetOf, null);
        o.powersetOf()
            .map(db()::findObjectOrError)
            .peek(set -> model.add(o.iri(), Vocab.powersetOf, set));
    }

    /* Note here that <core/rank> only applies to the rank classes, and
     * the value is the numerical rank of members of that rank class. So
     * we have <core/Individual> <core/rank> 0. for instance, even
     * though Individual itself is rank 1. We do not currently attempt
     * to infer <core/rank> for other objects. */
    private static final Query Q_rankSuperclasses = Vocab.query("""
        select ?obj ?class
        where {
            ?obj rdf:type/<core/rank> ?rank.
            ?class <core/rank> ?crank.
            filter (?crank = (?rank - 1))

            filter not exists {
                ?obj rdfs:subClassOf ?class.
            }
        }
    """);

    private void setRankSuperclasses ()
    {
        /* We must loop here, as there will be objects which don't have
         * a valid rank until their class has been assigned a rank
         * superclass. */
        while (true) {
            var supers = db().listQuery(Q_rankSuperclasses);
            if (supers.isEmpty())
                break;
            log.info("Setting rank superclasses: {}", supers);
            supers.forEach(qs ->
                db().derived().add(qs.getResource("obj"), RDFS.subClassOf,
                    qs.getResource("class")));
        }
    }

    private void loadConfigs (List<ConfSpec> configs)
    {
        /* It would be better if this returned a List<List>… */
        var split = configs.partition(c -> EARLY_APPS.contains(c.app()));

        for (var c : split._1())
            request().configEntry(c.app(), c.obj())
                .putValue(c.value());

        for (var c : split._2())
            request().configEntry(c.app(), c.obj())
                .putValue(c.value());
    }
}
