/*
 * Factory+ metadata database
 * Rx dataflow class
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.Optional;

import io.reactivex.rxjava3.core.*;
import io.reactivex.rxjava3.subjects.*;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.util.*;

public class Dataflow
{
    private static final Logger log = LoggerFactory.getLogger(Dataflow.class);

    private Subject<Dataset> modelUpdates = PublishSubject.create();
    private Observable<Update.Config> configUpdates = buildConfigUpdates();

    public void modelUpdate (Dataset update)
    {
        modelUpdates.onNext(update);
    }

    /* This will not produce correct results when an App is deleted (or
     * made not an App). Either this should be disallowed (impractical)
     * or it will need special handling. */
    private static final Query Q_appUpdates = Vocab.query("""
        select ?app ?obj ?value ?etag
        where {
            {   select distinct ?app ?obj
                where {
                    { graph <graph/added> { [] a ?app; <app/for> ?obj. } }
                    union { 
                        graph <graph/removed> { [] a ?app; <app/for> ?obj. } }
            } }


            graph <graph/derived> { ?app a <app/Application>. }
            # We must select out the current value from the derived
            # graph. We don't know what order the changes happened in so
            # we don't know which happened last.
            optional { graph <graph/derived> {
                ?conf a ?app;
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
            .map(sol -> {
                var val = Optional.of(sol)
                    .filter(s -> s.contains("value"))
                    .map(ConfigEntry.Value::ofQuerySolution);
                return new Update.Config(
                    sol.getResource("app"), sol.getResource("obj"), val);
            })
            .share();
    }

    public void run ()
    {
        configUpdates.subscribe(u -> log.info("CONFIG UPDATE: {}", u));
        log.info("SUBSCRIBED CONFIG UPDATES");
    }
}
