/*
 * Factory+ metadata database
 * Rx dataflow class
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

import jakarta.json.JsonValue;

import io.reactivex.rxjava3.core.*;
import io.reactivex.rxjava3.subjects.*;

import io.vavr.collection.*;
import io.vavr.control.Option;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.util.*;

public class Dataflow
{
    private static final Logger log = LoggerFactory.getLogger(Dataflow.class);

    private RdfStore db;

    private Subject<Dataset> modelUpdates = PublishSubject.create();
    private Observable<Update.Config> configUpdates = buildConfigUpdates();

    public Dataflow (RdfStore db)
    {
        this.db = db;
    }

    public void modelUpdate (Dataset update)
    {
        modelUpdates.onNext(update);
    }

    /* This will not produce correct results when an App is deleted (or
     * made not an App). Either this should be disallowed (impractical)
     * or it will need special handling. */
    private static final Query Q_appUpdates = Vocab.query("""
        select ?appU ?objU ?value ?etag
        where {
            {   select distinct ?app ?obj
                where {
                    { graph <graph/added> { [] a ?app; <app/for> ?obj. } }
                    union { graph <graph/removed> { [] a ?app; <app/for> ?obj. } }
            } }

            # We can't handle deleting Apps yet
            graph <graph/derived> { ?app a <app/Application>; <core/uuid> ?appU. }

            # …but we must search for the obj in the removed statements
            { graph <graph/derived> { ?obj <core/uuid> ?objU. } }
            union { graph <graph/removed> { ?obj <core/uuid> ?objU. } }

            # We must select out the current value from the derived
            # graph. We don't know what order the changes happened in so
            # we don't know which happened last.
            optional { graph <graph/derived> {
                [] a ?app;
                    <app/for> ?obj;
                    <doc/content> ?value;
                    <core/uuid> ?etag.
        } } }
    """);

    private Observable<Update.Config> buildConfigUpdates ()
    {
        return modelUpdates
            .map(ds -> QueryExecution.dataset(ds)
                .query(Q_appUpdates)
                .build().execSelect())
            .flatMap(rs -> Observable.<QuerySolution>create(em -> {
                rs.forEachRemaining(em::onNext);
                em.onComplete();
            }))
            .map(Update.Config::ofQuerySolution)
            .share();
    }

    public Observable<Update.Config> configUpdates () { return configUpdates; }

    public Observable<Update.Config> appUpdates (UUID app)
    {
        return configUpdates
            .filter(u -> u.app().equals(app));
    }

    /* XXX These find-entry queries have a lot of dupliction. I'm not
     * sure how best to avoid that; I don't really want to fall back to
     * iterating over a list all the time. */
    private static final Query Q_appState = Vocab.query("""
        select ?objU ?value ?etag
        where {
            ?app <core/uuid> ?appU.
            [] a ?app;
                <app/for> ?obj;
                <doc/content> ?value;
                <core/uuid> ?etag.
            ?obj <core/uuid> ?objU.
        }
    """);

    private Map<UUID, ConfigEntry.Value> appState (UUID app)
    {
        /* This method is not triggered by an Update, so it must use its
         * own transaction. */
        return db.calculateRead(() -> 
            Iterator.ofAll(db.selectQuery(Q_appState, 
                    "appU", Vocab.uuidLiteral(app)))
                .toMap(qs -> Util.decodeLiteral(qs.get("objU"), UUID.class),
                    ConfigEntry.Value::ofQuerySolution));
    }

    private CacheSeq<UUID, Map<UUID, ConfigEntry.Value>> _cacheAppValues
        = CacheSeq.builder(this::_buildAppValues)
            .withReplay()
            .build();

    private Observable<Map<UUID, ConfigEntry.Value>> _buildAppValues (UUID app)
    {
        return appUpdates(app)
            .scanWith(() -> appState(app),
                (st, upd) -> upd.value().fold(
                    () -> st.remove(upd.obj()),
                    val -> st.put(upd.obj(), val)))
            /* Include a half-second debounce as this will always be
             * what we want. */
            .debounce(500, TimeUnit.MILLISECONDS);
    }

    public Observable<Map<UUID, ConfigEntry.Value>> appValues (UUID app)
    {
        return _cacheAppValues.get(app);
    }

    public void start ()
    {
        configUpdates.subscribe(u -> log.info("CONFIG UPDATE: {}", u));
        log.info("SUBSCRIBED CONFIG UPDATES");
    }
}
