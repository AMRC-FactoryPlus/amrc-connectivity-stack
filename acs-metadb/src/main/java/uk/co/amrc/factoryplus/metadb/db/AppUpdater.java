/*
 * Factory+ metadata database
 * Structured app update processor
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.HashSet;
import java.util.Map;
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

public class AppUpdater extends RequestHandler.Component
{
    private static final Logger log = LoggerFactory.getLogger(AppUpdater.class);

    private ObjectStructure objs;
    private AppMapper mapper;

    public AppUpdater (RequestHandler req)
    {
        super(req);
        this.objs = request().objectStructure();
        this.mapper = db().appMapper();
    }

    private static final Query Q_findUpdates = Vocab.query("""
        select ?app ?obj
        where {
            ?app a <app/Structured>;
                <app/appliesTo> ?domain.
            ?obj a ?domain;
                <core/uuid> ?uuid.

            # We do not generate Reg entries here, they must be done in
            # a second pass.
            filter(?app != <app/Registration>)
        }
    """);
    private static Query Q_findObjects = Vocab.query("""
        select ?obj
        where {
            ?obj <core/uuid> ?uuid.

            # We don't generate Reg entries for Reg entries.
            filter not exists {
                ?obj a <app/Registration>.
            }
        }
    """);
    /* This query assumes we do not have sub-apps, so that a given
     * ConfigEntry is a member of only one App. If SPARQL had DELETE
     * RETURNING this could be an UpdateRequest: we must know what was
     * removed to send notify updates.
     */
    private static Query Q_orphanConfigs = Vocab.query("""
        select ?conf ?app ?obj
        where {
            ?conf a ?app; <app/for> ?obj.
            ?app a <app/Structured>; <app/appliesTo> ?domain.

            filter not exists { ?obj a ?domain. }
        }
    """);

    public void update ()
    {
        var updates = db().selectQuery(Q_findUpdates)
            .materialise();
        updates.forEachRemaining(row -> {
            var app = row.getResource("app");
            var obj = row.getResource("obj");
            updateEntry(app, obj);
        });

        /* We update Reg entries in a second pass, as updating the other
         * entries will have created registered objects. */
        var objects = db().selectQuery(Q_findObjects)
            .materialise();
        objects.forEachRemaining(row -> {
            var obj = row.getResource("obj");
            updateEntry(Vocab.App.Registration, obj);
        });

        var orphans = db().selectQuery(Q_orphanConfigs)
            .materialise();
        orphans.forEachRemaining(row -> {
            var conf = row.getResource("conf");
            db().removeResource(conf);
        });
    }

    private void updateEntry (Resource app, Resource obj)
    {
        //log.info("Updating {} {}", app, obj);
        var entry = request().configEntry(app, obj);
        mapper.generateConfig(app, obj)
            .peek(entry::putRawValue)
            .onEmpty(entry::removeRawValue);
    }

}
