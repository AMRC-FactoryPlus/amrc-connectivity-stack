/*
 * Factory+ metadata database
 * App config schema tracker
 * Copyright 2026 University of Sheffield AMRC
 */

/* This class tracks and validates the Application Config Schema
 * entries. This is purely an API-layer validation; there is no way to
 * prevent SPARQL access from inserting invalid config entries. */

package uk.co.amrc.factoryplus.metadb.db;

import java.net.URI;
import java.util.UUID;

import jakarta.json.*;

import dev.harrel.jsonschema.*;
import dev.harrel.jsonschema.providers.*;

import io.vavr.collection.*;
import io.vavr.control.*;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class SchemaTracker
{
    private static final Logger log = LoggerFactory.getLogger(SchemaTracker.class);

    private record SchemaSet (Validator validator, Set<Resource> apps)
    { 
        public boolean validate (Resource app, JsonValue config)
        {
            if (!apps.contains(app))
                return true;

            var result = validator.validate(resURI(app), config);

            result.getErrors().forEach(err ->
                log.info("Validation failed for {}: {}", app, err));
            return result.isValid();
        }
    }

    private record Entry (Resource obj, UUID uuid, JsonValue value)
    {
        public static Entry ofQS (QuerySolution qs)
        {
            return new Entry(qs.getResource("obj"),
                Util.decodeLiteral(qs.get("uuid"), UUID.class),
                Util.decodeLiteral(qs.get("value"), JsonValue.class));
        }
    }

    private RdfStore            db;
    private ValidatorFactory    factory;

    /* Updates to this field always occurs within a Jena RW
     * transaction. This provides a global lock. We rely on this for
     * consistency. */
    private SchemaSet           schemas;

    public SchemaTracker (RdfStore db)
    {
        this.db = db;

        factory = new ValidatorFactory()
            .withJsonNodeFactory(new JakartaJsonNode.Factory())
            .withDefaultDialect(new Dialects.Draft2020Dialect())
            .withEvaluatorFactory(new FormatEvaluatorFactory());

        /* We have no schemas until start() */
        schemas = new SchemaSet(factory.createValidator(), HashSet.empty());
    }

    public void start ()
    {
        schemas = db.calculateRead(() -> rebuildSchemas());
    }

    public boolean validate (Resource app, JsonValue config)
    {
        return schemas.validate(app, config);
    }

    /** @param app A list of apps to validate
     */
    public void updateSchemas (List<Resource> apps)
    {
        /* We must rebuild all schemas, annoyingly. */
        var newSchemas = rebuildSchemas();

        apps.filter(newSchemas.apps::contains)
            .forEach(app -> {
                var conflicts = findConfigs(app)
                    .filter(e -> !newSchemas.validate(app, e.value()))
                    .map(Entry::uuid)
                    .toSet();
                if (!conflicts.isEmpty())
                    throw new Err.SchemaConflict(conflicts);
            });

        schemas = newSchemas;
    }

    private static URI resURI (Resource res)
    {
        var uri = res.getURI();
        try {
            return new URI(uri);
        }
        catch (Throwable e) {
            throw new Err.CorruptRDF("Invalid IRI: " + uri);
        }
    }

    private static final Query Q_findConfigs = Vocab.query("""
        select ?obj ?uuid ?value
        where {
            [] a ?app; <app/for> ?obj; <doc/content> ?value.
            ?obj <core/uuid> ?uuid.
        }
    """);
    private Iterator<Entry> findConfigs (Resource app)
    {
        return Iterator.ofAll(db.selectQuery(Q_findConfigs, "app", app))
            .map(Entry::ofQS);
    }

    private SchemaSet rebuildSchemas ()
    {
        var configs = findConfigs(Vocab.App.ConfigSchema).toList();
        var apps    = configs.map(Entry::obj).toSet();
        var val     = factory.createValidator();

        configs.forEach(entry -> 
            val.registerSchema(resURI(entry.obj()), entry.value()));

        return new SchemaSet(val, apps);
    }
}
