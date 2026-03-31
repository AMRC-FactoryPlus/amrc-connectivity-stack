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
import io.reactivex.rxjava3.observables.ConnectableObservable;

import io.vavr.collection.*;
import io.vavr.control.*;

import org.apache.jena.rdf.model.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class SchemaTracker
{
    private static final Logger log = LoggerFactory.getLogger(SchemaTracker.class);

    private ValidatorFactory factory;
    private ConnectableObservable<Validator> validators;

    public SchemaTracker (RdfStore db)
    {
        factory = new ValidatorFactory()
            .withJsonNodeFactory(new JakartaJsonNode.Factory())
            .withDefaultDialect(new Dialects.Draft2020Dialect())
            .withEvaluatorFactory(new FormatEvaluatorFactory());

        validators = db.dataflow()
            .appEntries(Vocab.App.ConfigSchema)
            /* We must rebuild the whole validator every time, as there is
             * no way to unregister a schema, and re-registering can cause
             * errors. */
            .map(schemas -> {
                log.info("Building new validator");
                var val = factory.createValidator();
                schemas.forEach((app, schema) ->
                    Try.of(() -> new URI(app.getURI()))
                        .andThen(uri -> {
                            log.info("  {}: {}", uri, schema);
                            val.registerSchema(uri, schema);
                        }));
                return val;
            })
            .replay(1);
    }

    public void start ()
    {
        validators.connect();
    }

    public boolean validate (Resource app, JsonValue config)
    {
        var uri = Try.of(() -> new URI(app.getURI()))
            .getOrElseThrow(e -> new Err.CorruptRDF("Invalid IRI"));
        var validator = validators.blockingFirst();
        var result = validator.validate(uri, config);

        result.getErrors().forEach(err ->
            log.info("Validation failed for {}: {}", app, err));
        return result.isValid();
    }
}
