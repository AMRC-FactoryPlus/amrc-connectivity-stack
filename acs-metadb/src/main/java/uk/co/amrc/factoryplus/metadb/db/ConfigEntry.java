/*
 * Factory+ metadata database
 * Config entry handling
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.io.StringReader;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import jakarta.json.*;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.update.*;
import org.apache.jena.vocabulary.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ConfigEntry extends RequestHandler.Component
{
    private static final Logger log = LoggerFactory.getLogger(ConfigEntry.class);

    private Resource app;
    private Resource obj;

    public ConfigEntry (RequestHandler req, Resource app, Resource obj)
    {
        super(req);
        this.app = app;
        this.obj = obj;
    }

    public static ConfigEntry create (RequestHandler req, UUID app, UUID obj)
    {
        var appO = req.db().findObjectOrError(app);
        var objO = req.db().findObjectOrError(obj);

        return new ConfigEntry(req, appO.node(), objO.node());
    }

    public record Value (JsonValue value, String etag, Instant mtime) {}

    private static final Query Q_getValue = Vocab.query("""
        select ?value ?etag ?mtime
        where {
            ?config a ?app;
                <app/for> ?obj;
                <app/value> ?value.
            ?config <core/start> ?instant.
            ?instant <core/uuid> ?etag;
                <core/timestamp> ?mtime.
        }
    """);

    public Optional<Value> getValue ()
    {
        return db().optionalQuery(Q_getValue, "app", app, "obj", obj)
            .map(binding -> {
                var val = Util.decodeLiteral(binding.get("value"), RDF.JSON,
                    s -> Json.createReader(new StringReader(s)).readValue());
                var etag = Util.decodeLiteral(binding.get("etag"), XSD.xstring, s -> s);
                var mtime = Util.decodeLiteral(binding.get("mtime"), XSD.dateTime, 
                    Instant::parse);

                return new Value(val, etag, mtime);
            });
    }

    /* This removes an existing ConfigEntry. For a more 4D approach we
     * could instead set an :end Instant and adjust getValue to only
     * look for entries without an end. */
    private static final UpdateRequest U_removeValue = Vocab.update("""
        delete {
            ?entry ?p ?o.
        }
        where {
            ?entry a ?app; <app/for> ?obj.
            ?entry ?p ?o.
        }
    """);

    public void removeValue ()
    {
        db().runUpdate(U_removeValue, "app", app, "obj", obj);
    }

    public boolean putValue (JsonValue value)
    {
        var existing = getValue()
            .map(Value::value)
            .filter(v -> v.equals(value));
        if (existing.isPresent()) {
            log.info("Duplicate config update suppressed");
            return false;
        }

        removeValue();

        var json = ResourceFactory.createTypedLiteral(
            value.toString(), RDF.dtRDFJSON);

        var graph   = db().derived();
        var entry   = graph.createResource();
        var inst    = request().getInstant();

        graph.add(entry, RDF.type, app);
        graph.add(entry, Vocab.forP, obj);
        graph.add(entry, Vocab.value, json);
        graph.add(entry, Vocab.start, inst);

        return true;
    }
}

