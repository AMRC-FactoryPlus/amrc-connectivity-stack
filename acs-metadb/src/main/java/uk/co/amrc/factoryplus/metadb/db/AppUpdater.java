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
import java.util.function.Function;

import jakarta.json.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.vocabulary.*;

import io.vavr.control.Try;

public class AppUpdater extends RequestHandler.Component
{
    private static final Logger log = LoggerFactory.getLogger(AppUpdater.class);

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

    public void publish ()
    {
        log.info("Config updates:");
        for (var c : updated)
            log.info("  {} {}", c.app(), c.obj());
    }

    public Optional<JsonValue> generateConfig (Resource app, Resource obj)
    {
        return Optional.of(generators.get(app))
            .flatMap(q -> db().optionalQuery(q, "obj", obj))
            .map(this::solutionToJson);
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

    /* We have to bypass Jena's RDFDatatype system here and provide our
     * own mappings. We cannot map arbitrary objects to JSON, and the
     * JSON creation functions will not accept Object. */
    private static final Map<Resource, 
            Function<String, Optional<JsonValue>>> toJson = Map.of(
        XSD.xstring,    s -> Optional.of(Json.createValue(s)),
        XSD.xint,       s -> Try.of(() -> Integer.parseInt(s))
                                .toJavaOptional()
                                .map(Json::createValue),
        XSD.xboolean,   s -> s.equals("true") ? Optional.of(JsonValue.TRUE)
                            : s.equals("false") ? Optional.of(JsonValue.FALSE)
                            : Optional.empty(),
        RDF.JSON,       Util::readJson);

    /* Currently this does dynamic decoding based on what was returned
     * from the RDF. Once we have query generation we should be able to
     * use the <core/to> properties to know what we are expecting. */
    private JsonValue literalToJson (RDFNode node)
    {
        /* This should probably be selected based on optional/nullable
         * properties in the schema. */
        if (node == null) return JsonValue.NULL;

        if (!node.isLiteral())
            throw new Err.NotLiteral(node);
        
        var lit = node.asLiteral();
        var typ = ResourceFactory.createResource(lit.getDatatypeURI());

        return Optional.ofNullable(toJson.get(typ))
            .flatMap(d -> d.apply(lit.getLexicalForm()))
            .orElseThrow(() -> new Err.BadLiteral(lit));
    }

    private JsonValue solutionToJson (QuerySolution rs)
    {
        var jobj = Json.createObjectBuilder();
        rs.varNames().forEachRemaining(n ->
            jobj.add(n, literalToJson(rs.get(n))));

        return jobj.build();
    }

    /* Specific updaters for individual Apps. These should be replaced
     * with queries generated from schema entries. */

    private static final Query Q_objectRegistration = Vocab.query("""
        select ?uuid ?rank ?class ?owner ?strict ?deleted
        where {
            ?obj <core/uuid> ?uuid.
            optional {
                ?obj rdf:type/<core/rank> ?rank;
                    <core/primary>/<core/uuid> ?class.
            }

            optional { ?obj <core/owner>/<core/uuid> ?_1. }
            bind(coalesce(?_1, "091e796a-65c0-4080-adff-c3ce01a65b2e") as ?owner)

            optional { ?obj <core/deleted> ?_2. }
            bind(coalesce(?_2, false) as ?deleted)

            bind(true as ?strict)
        }
    """);

    private static final Query Q_generalInfo = Vocab.query("""
        select ?name
        where {
            ?obj <core/name> ?name.
        }
    """);

    /* XXX This is hardcoded for now. */
    private static final Map<Resource, Query> generators = Map.of(
        Vocab.Registration,     Q_objectRegistration,
        Vocab.Info,             Q_generalInfo);
}
