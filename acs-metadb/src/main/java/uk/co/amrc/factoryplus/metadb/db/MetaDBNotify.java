/*
 * Factory+ metadata database
 * Change-notify handling
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;

import jakarta.json.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.reactivex.rxjava3.core.*;
import io.vavr.collection.*;

import uk.co.amrc.factoryplus.notify.*;

public class MetaDBNotify
{
    private static final Logger log = LoggerFactory.getLogger(MetaDBNotify.class);

    private Dataflow data;
    private NotifyV2 notify;

    public MetaDBNotify (RdfStore db)
    {
        data = db.dataflow();

        notify = NotifyV2.builder()
            .watch("v2/app/{app}/object/", this::appList)
            .search("v2/app/{app}/object/", this::appSearch)
            .build();
    }

    public NotifyV2 notifyV2 () { return notify; }

    private static <U> Observable<Response> setUpdates (Observable<Set<U>> src)
    {
        return src
            .map(s -> s.map(u -> u.toString()))
            .map(s -> s.foldLeft(Json.createArrayBuilder(), (a, v) -> a.add(v))
                .build())
            .map(Response::ok);
    }

    /* XXX These app endpoints will return empty maps for nonexistent
     * apps. I think the ConfigDB returned 404s if the app had no
     * configs, which is also not correct. Probably appValues needs to
     * return an Observable<Option<Map>>. */

    private Observable<Response> appList (Session sess, Map<String, String> args)
    {
        log.info("appList: {}", args);
        return args.get("app")
            .flatMap(Util::parseUUID)
            .map(app -> data.appValues(app)
                .map(m -> m.keySet())
                .compose(MetaDBNotify::setUpdates))
            .getOrElse(Observable.just(Response.status(410)));
    }

    private Observable<SearchUpdate> appSearch (Session sess, Map<String, String> args)
    {
        log.info("appSearch: {}", args);
        return args.get("app")
            .flatMap(Util::parseUUID)
            .map(app -> data.appValues(app)
                .map(m -> m.mapKeys(UUID::toString)
                    .mapValues(v -> Response.ok(v.value(), v.etag())))
                .map(SearchUpdate::full))
            .getOrElse(Observable.just(SearchUpdate.invalid()));
    }
}
