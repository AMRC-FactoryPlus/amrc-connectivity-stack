/*
 * Factory+ metadata database
 * Config entry handling
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.io.StringReader;
import java.time.Instant;
import java.util.UUID;

import jakarta.json.*;

import io.vavr.control.Option;

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

    public record Value (JsonValue value, String etag, Option<Instant> mtime)
    {
        public static Value ofQuerySolution (QuerySolution sol)
        {
            var val = Util.decodeLiteral(sol.get("value"), JsonValue.class);
            var etag = Util.decodeLiteral(sol.get("etag"), String.class);
            //var mtime = Util.decodeLiteral(binding.get("mtime"), Instant.class);

            return new Value(val, etag, Option.none());
        }
    }

    private boolean isStructured ()
    {
        return db().derived().contains(app, RDF.type, Vocab.App.Structured);
    }

    private static final Query Q_getValue = Vocab.query("""
        select ?value ?etag
        where {
            ?config a ?app;
                <app/for> ?obj;
                <core/uuid> ?etag;
                <doc/content> ?value.
        }
    """);

    public Option<Value> getValue ()
    {
        return db().optionalQuery(Q_getValue, "app", app, "obj", obj)
            .map(Value::ofQuerySolution);
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
        if (isStructured())
            db().appMapper().deleteConfig(app, obj);
        else
            removeRawValue();
    }

    public void removeRawValue ()
    {
        db().runUpdate(U_removeValue, "app", app, "obj", obj);
    }

    public void putValue (JsonValue value)
    {
        var schemas = db().schemaTracker();
        if (!schemas.validate(app, value))
            throw new Err.BadConfig(app, value);

        if (isStructured())
            db().appMapper().updateConfig(app, obj, value);
        else
            putRawValue(value);
    }

    /* Returns a Value if we made an update. Returns empty() if the
     * value has not changed and we didn't update it. */
    public Option<Value> putRawValue (JsonValue value)
    {
        var existing = getValue()
            .map(Value::value)
            .filter(v -> v.equals(value));
        if (existing.isDefined()) {
            //log.info("Duplicate config update suppressed");
            return Option.none();
        }

        removeRawValue();

        var json = ResourceFactory.createTypedLiteral(
            value.toString(), RDF.dtRDFJSON);

        var graph   = db().derived();
        var entry   = db().createObject(app);
        //var inst    = request().getInstant();

        graph.add(entry.node(), Vocab.App.forP, obj);
        graph.add(entry.node(), Vocab.Doc.content, json);
        //graph.add(entry, Vocab.Time.start, inst);

        return Option.some(new Value(
            value, entry.uuid().toString(), Option.none()));
    }
}

