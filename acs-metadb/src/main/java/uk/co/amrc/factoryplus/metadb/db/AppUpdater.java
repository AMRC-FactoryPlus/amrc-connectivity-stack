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

public class AppUpdater extends RequestHandler.Component
{
    private static final Logger log = LoggerFactory.getLogger(AppUpdater.class);

    private record Config (Resource app, Resource obj) {}

    private ObjectStructure objs;
    private AppMapper mapper;
    private Set<Config> updated;

    public AppUpdater (RequestHandler req)
    {
        super(req);
        this.objs = request().objectStructure();
        this.mapper = db().appMapper();
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
            updateEntry(Vocab.App.Registration, now);
        }
    }

    public void publish ()
    {
        log.info("Config updates:");
        for (var c : updated)
            log.info("  {} {}", c.app(), c.obj());
    }

    private void updateEntry (Resource app, Resource obj)
    {
        /* XXX We need to remove redundant entries */

        log.info("Updating {} {}", app, obj);
        var changed = mapper.generateConfig(app, obj)
            .map(v -> request().configEntry(app, obj).putRawValue(v))
            .orElse(false);

        if (changed)
            updated.add(new Config(app, obj));
    }

}
