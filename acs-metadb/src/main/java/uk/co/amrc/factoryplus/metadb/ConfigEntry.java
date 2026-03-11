/*
 * Factory+ metadata database
 * Config entry handling
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb;

import java.io.StringReader;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import jakarta.json.*;

import io.vavr.*;
import io.vavr.control.*;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.vocabulary.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ConfigEntry
{
    private static final Logger log = LoggerFactory.getLogger(ConfigEntry.class);

    private RdfStore store;
    private UUID app;
    private UUID object;

    public ConfigEntry (RdfStore store, UUID app, UUID object)
    {
        this.store = store;
        this.app = app;
        this.object = object;
    }

    public UUID app () { return app; }
    public UUID object () { return object; }

    public record Value (JsonValue value, String etag, Instant mtime) {}

    public static class Error extends CorruptionException
    {
        private UUID app;

        public Error (String msg, UUID app, UUID obj)
        {
            super(msg, obj);
            this.app = app;
        }

        public UUID app () { return app; }
    }

    private Error error (String fmt, Object... args)
    {
        String msg = String.format(fmt, args);
        return new Error(msg, app, object);
    }

    private <T> T extractLiteral (RDFNode node, Resource type, 
        CheckedFunction1<String, T> extract)
    {
        return Try.success(node)
            .map(n -> n.asLiteral())
            .filter(l -> l.getDatatypeURI().equals(type.getURI()),
                l -> error("Incorrect literal type (%s vs %s)",
                    l.getDatatypeURI(), type.getURI()))
            .flatMap(l -> Try.success(l.getString())
                .mapTry(extract)
                .recoverWith(e -> {
                    log.warn("Failed to decode literal", e);
                    return Try.failure(error("Bad literal"));
                }))
            .get();
    }

    private static final String Q_getValue = """
        select ?value ?etag ?mtime
        where {
            ?appI <core/uuid> ?app.
            ?objI <core/uuid> ?obj.
            ?config a ?appI;
                <app/for> ?objI;
                <app/value> ?value.
            ?config <core/start> ?instant.
            ?instant <core/uuid> ?etag;
                <core/timestamp> ?mtime.
        }
    """;

    public Optional<Value> getValue ()
    {
        var exec = store.getQuery("config/get", Q_getValue)
            .substitution("app", Vocab.uuidLiteral(app))
            .substitution("obj", Vocab.uuidLiteral(object))
            .build();
        var rs = exec.execSelect();
        
        if (!rs.hasNext())
            return Optional.empty();
        var binding = rs.next();

        if (rs.hasNext())
            throw error("Duplicate config entries");

        var val = extractLiteral(binding.get("value"), RDF.JSON,
            s -> Json.createReader(new StringReader(s)).readValue());
        var etag = extractLiteral(binding.get("etag"), XSD.xstring, s -> s);
        var mtime = extractLiteral(binding.get("mtime"), XSD.dateTime, 
            Instant::parse);

        return Optional.of(new Value(val, etag, mtime));
    }
}

