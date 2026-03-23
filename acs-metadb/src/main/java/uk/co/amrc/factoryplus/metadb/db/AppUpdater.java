/*
 * Factory+ metadata database
 * Structured app update processor
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;

public class AppUpdater
{
    private static final Logger log = LoggerFactory.getLogger(AppUpdater.class);

    private record Config (UUID app, UUID obj) {}

    private RdfStore db;
    private ObjectStructure objs;
    private Set<Config> updated;

    public AppUpdater (RdfStore db)
    {
        this.db = db;
        this.objs = db.objectStructure();
        this.updated = new HashSet<>();
    }

    private static final Query Q_findUpdates = Vocab.query("""
        select ?app ?obj ?appUUID ?objUUID
        where {
            ?app a <app/Structured>;
                <core/uuid> ?appUUID;
                <app/appliesTo> ?domain.
            ?obj a ?domain;
                <core/uuid> ?objUUID.
        }
    """);

    public void update ()
    {
        var updates = db.selectQuery(Q_findUpdates)
            .materialise();

        updates.forEachRemaining(update -> {
            var app = update.getResource("app");
            var obj = update.getResource("obj");

            if (!app.equals(Vocab.Registration)) {
                log.info("Can't update app {}", app);
                return;
            }
            log.info("Updating {} {}", app, obj);
            var newVal = objs.objectRegistration(obj);
            var changed = db.configEntry(app, obj).putValue(newVal);

            if (changed) {
                var appUUID = UUID.fromString(
                    update.getLiteral("appUUID").getString());
                var objUUID = UUID.fromString(
                    update.getLiteral("objUUID").getString());

                updated.add(new Config(appUUID, objUUID));
            }
        });
    }
    
    public void publish ()
    {
        log.info("Config updates:");
        for (var c : updated)
            log.info("  {} {}", c.app(), c.obj());
    }
}
