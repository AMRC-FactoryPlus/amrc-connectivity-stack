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

import jakarta.json.*;

import dev.harrel.jsonschema.*;
import dev.harrel.jsonschema.providers.*;

import io.reactivex.rxjava3.core.*;

import io.vavr.collection.*;
import io.vavr.control.*;

import org.apache.jena.rdf.model.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class SchemaTracker
{
    private static final Logger log = LoggerFactory.getLogger(SchemaTracker.class);

    private ValidatorFactory factory;
    private Validator validator;
    private Observable<Map<Resource, JsonValue>> schemaUpdates;

    public SchemaTracker (RdfStore db)
    {
        factory = new ValidatorFactory()
            .withJsonNodeFactory(new JakartaJsonNode.Factory())
            .withDefaultDialect(new Dialects.Draft2020Dialect())
            .withEvaluatorFactory(new FormatEvaluatorFactory());

        schemaUpdates = db.dataflow().appEntries(Vocab.App.ConfigSchema);
    }

    public void start ()
    {
        /* We must rebuild the whole validator every time, as there is
         * no way to unregister a schema, and re-registering can cause
         * errors. */
        schemaUpdates.subscribe(schemas -> {
            log.info("Building new validator");
            var val = factory.createValidator();
            schemas.forEach((app, schema) ->
                Try.of(() -> new URI(app.getURI()))
                    .andThen(uri -> {
                        log.info("  {}: {}", uri, schema);
                        val.registerSchema(uri, schema);
                    }));
            validator = val;
        });
    }
}
