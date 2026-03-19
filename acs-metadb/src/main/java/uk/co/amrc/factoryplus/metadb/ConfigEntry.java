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
import org.apache.jena.update.*;
import org.apache.jena.vocabulary.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ConfigEntry extends RequestHandler
{
    private static final Logger log = LoggerFactory.getLogger(ConfigEntry.class);

    private FPObject app;
    private FPObject obj;

    private ConfigEntry (RdfStore db, FPObject app, FPObject obj)
    {
        super(db);
        this.app = app;
        this.obj = obj;
    }

    public static ConfigEntry create (RdfStore db, UUID app, UUID obj)
    {
        var appO = db.findObjectOrError(app);
        var objO = db.findObjectOrError(obj);

        return new ConfigEntry(db, appO, objO);
    }

    public record Value (JsonValue value, String etag, Instant mtime) {}

    private Err.Config error (String fmt, Object... args)
    {
        String msg = String.format(fmt, args);
        return new Err.Config(msg, app.uuid(), obj.uuid());
    }

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
        var exec = QueryExecution.dataset(db.dataset())
            .query(Q_getValue)
            .substitution("app", app.node())
            .substitution("obj", obj.node())
            .build();
        var rs = exec.execSelect();
        
        if (!rs.hasNext())
            return Optional.empty();
        var binding = rs.next();

        if (rs.hasNext()) 
            throw error("Duplicate config entries");

        var val = Util.decodeLiteral(binding.get("value"), RDF.JSON,
            s -> Json.createReader(new StringReader(s)).readValue());
        var etag = Util.decodeLiteral(binding.get("etag"), XSD.xstring, s -> s);
        var mtime = Util.decodeLiteral(binding.get("mtime"), XSD.dateTime, 
            Instant::parse);

        return Optional.of(new Value(val, etag, mtime));
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
        UpdateExecution.dataset(db.dataset())
            .update(U_removeValue)
            .substitution("app", app.node())
            .substitution("obj", obj.node())
            .execute();
    }

    public void putValue (JsonValue value)
    {
        removeValue();

        var json = ResourceFactory.createTypedLiteral(
            value.toString(), RDF.dtRDFJSON);

        var graph   = db.derived();
        var entry   = graph.createResource();
        var inst    = db.createInstant();

        graph.add(entry, RDF.type, app.node());
        graph.add(entry, Vocab.forP, obj.node());
        graph.add(entry, Vocab.value, json);
        graph.add(entry, Vocab.start, inst);
    }
}

