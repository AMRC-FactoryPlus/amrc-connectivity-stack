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

import uk.co.amrc.factoryplus.client.*;
import uk.co.amrc.factoryplus.notify.*;
import uk.co.amrc.factoryplus.service.*;
import uk.co.amrc.factoryplus.util.*;

public class MetaDBNotify
{
    private static final Logger log = LoggerFactory.getLogger(MetaDBNotify.class);

    private FPAuth auth;
    private Dataflow data;
    private NotifyV2 notify;

    public MetaDBNotify (RdfStore db)
    {
        auth = db.fplus().auth();
        data = db.dataflow();

        notify = NotifyV2.builder(db.auth())
            .watch("v2/app/{app}/object/", this::appList)
            .search("v2/app/{app}/object/", this::appSearch)
            .build();
    }

    public NotifyV2 notifyV2 () { return notify; }

    private static <U> Response setUpdate (Response<Set<U>> src)
    {
        return src
            .map(s -> s.map(u -> u.toString()))
            .map(s -> s.foldLeft(Json.createArrayBuilder(), (a, v) -> a.add(v))
                .build());
    }

    /* Unit is a type which conveys no useful information. It has one
     * value, Unit.UNIT. In this case, we have nothing useful to say in
     * the success case, but information to convey in the error cases. */
    private Observable<Response<Unit>> watchACL (Session sess, UUID perm, UUID targ)
    {
        return auth.watchPermitted(sess.upn(), perm, targ)
            .map(res -> res
                .handle(st -> {
                    log.info("Error watching ACL: {}", st);
                    return Response.of(503);
                })
                .flatMap(ok -> ok ? Response.ok(Unit.UNIT) : Response.of(403)));
    }

    /* XXX These app endpoints will return empty maps for nonexistent
     * apps. I think the ConfigDB returned 404s if the app had no
     * configs, which is also not correct. Probably appValues needs to
     * return an Observable<Option<Map>>. */

    private Observable<Response> appList (Session sess, Map<String, String> args)
    {
        log.info("appList: {}", args);
        return args.get("app")
            .flatMap(Decoders::parseUUID)
            .map(app -> Observable.combineLatest(
                    data.appValues(app),
                    watchACL(sess, Vocab.Perm.ReadApp, app),
                    (configs, ok) -> ok.map(u -> configs.keySet()))
                .map(MetaDBNotify::setUpdate))
            .getOrElse(Observable.just(Response.of(410)));
    }

    private Observable<SearchUpdate> appSearch (Session sess, Map<String, String> args)
    {
        log.info("appSearch: {}", args);
        return args.get("app")
            .flatMap(Decoders::parseUUID)
            .map(app -> Observable.combineLatest(
                    data.appValues(app),
                    watchACL(sess, Vocab.Perm.ReadApp, app),
                    (configs, ok) -> ok.map(u -> configs
                        .mapKeys(UUID::toString)
                        .mapValues(v -> v.toResponse())))
                .map(SearchUpdate::ofResponse))
            .getOrElse(Observable.just(SearchUpdate.invalid()));
    }
}
