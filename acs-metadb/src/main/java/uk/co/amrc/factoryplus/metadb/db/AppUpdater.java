/*
 * Factory+ metadata database
 * Structured app update processor
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.HashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.BiFunction;

import jakarta.json.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.vocabulary.*;

public class AppUpdater extends RequestHandler.Component
{
    private static final Logger log = LoggerFactory.getLogger(AppUpdater.class);

    /* XXX This is hardcoded for now. */
    private static final Map<Resource,
            BiFunction<AppUpdater, Resource, Optional<JsonValue>>> generators = 
        Map.of(
            Vocab.Registration,     AppUpdater::objectRegistration,
            Vocab.Info,             AppUpdater::generalInfo);

    private record Config (Resource app, Resource obj) {}

    private ObjectStructure objs;
    private Set<Config> updated;

    public AppUpdater (RequestHandler req)
    {
        super(req);
        this.objs = request().objectStructure();
        this.updated = new HashSet<>();
    }

    private static final Query Q_findUpdates = Vocab.query("""
        select ?app ?obj
        where {
            ?app a <app/Structured>;
                <app/appliesTo> ?domain.
            ?obj a ?domain;
                <core/uuid> ?uuid.
        }
    """);

    public void update ()
    {
        var updates = db().selectQuery(Q_findUpdates)
            .materialise();

        updates.forEachRemaining(update -> {
            var app = update.getResource("app");
            var obj = update.getResource("obj");
            updateEntry(app, obj);
        });

        /* We may have created the current instant in order to update a
         * config entry. In this case it may not have been captured by
         * the first pass through the changes. But we don't want to
         * store an Instant if we don't need one. */
        if (!updated.isEmpty()) {
            var now = request().getInstant();
            updateEntry(Vocab.Registration, now);
        }
    }

    private void updateEntry (Resource app, Resource obj)
    {
        log.info("Updating {} {}", app, obj);
        var changed = generateConfig(app, obj)
            .map(v -> request().configEntry(app, obj).putValue(v))
            .orElse(false);

        if (changed)
            updated.add(new Config(app, obj));
    }

    public Optional<JsonValue> generateConfig (Resource app, Resource obj)
    {
        return Optional.of(generators.get(app))
            .flatMap(gen -> gen.apply(this, obj));
    }

    public void publish ()
    {
        log.info("Config updates:");
        for (var c : updated)
            log.info("  {} {}", c.app(), c.obj());
    }

    /* Specific updaters for individual Apps. These should be replaced
     * with queries generated from schema entries. */

    private static final Query Q_objectRegistration = Vocab.query("""
        select ?uuid ?rank ?class
        where {
            ?obj <core/uuid> ?uuid.
            optional {
                ?obj rdf:type/<core/rank> ?rank;
                    <core/primary>/<core/uuid> ?class.
            }
        }
    """);

    private Optional<JsonValue> objectRegistration (Resource obj)
    {
        return db().optionalQuery(Q_objectRegistration, "obj", obj)
            .map(rs -> {
                String uuid = Util.decodeLiteral(rs.get("uuid"), XSD.xstring, s -> s);
                var rank = Optional.ofNullable(rs.get("rank"))
                    .map(l -> Util.decodeLiteral(l, XSD.xint, Integer::valueOf))
                    .<JsonValue>map(Json::createValue)
                    .orElse(JsonValue.NULL);
                var klass = Optional.ofNullable(rs.get("class"))
                    .map(l -> Util.decodeLiteral(rs.get("class"), XSD.xstring, s -> s))
                    .<JsonValue>map(Json::createValue)
                    .orElse(JsonValue.NULL);

                var rv = Json.createObjectBuilder()
                    .add("uuid", uuid)
                    .add("rank", rank)
                    .add("class", klass)
                    /* These entries are fake, for now */
                    .add("owner", Vocab.U_Unowned.toString())
                    .add("strict", true)
                    .add("deleted", false);
                return rv.build();
            });
    }

    private static final Query Q_generalInfo = Vocab.query("""
        select ?name
        where {
            ?obj <core/name> ?name.
        }
    """);

    private Optional<JsonValue> generalInfo (Resource obj)
    {
        return db().optionalQuery(Q_generalInfo, "obj", obj)
            .map(rs -> {
                String name = Util.decodeLiteral(rs.get("name"), XSD.xstring, s -> s);

                return Json.createObjectBuilder()
                    .add("name", name)
                    .build();
            });
    }
}
