/*
 * Factory+ metadata database
 * Change-notify handling
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;
import java.util.function.Function;

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
            .watch("v2/class/{class}/member/", this::classMembers)
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


    private record SubHandler (Session sess, Map<String, String> args)
    {
        private <T> Observable<Response<T>> fromUUID (
            String arg,
            Function<UUID, Observable<T>> factory,
            UUID permission)
        {
            return args.get(arg)
                .flatMap(Decoders::parseUUID)
                .map(uuid -> factory.apply(uuid)
                    .map(Response::ok)
                    .compose(sess.applyACL(permission, uuid)))
                .getOrElse(Observable.just(Response.of(410)));
        }
    }

    /* XXX These app endpoints will return empty maps for nonexistent
     * apps. I think the ConfigDB returned 404s if the app had no
     * configs, which is also not correct. Probably appValues needs to
     * return an Observable<Option<Map>>. */

    private Observable<Response> appList (Session sess, Map<String, String> args)
    {
        log.info("appList: {}", args);
        return new SubHandler(sess, args)
            .fromUUID("app", data::appValues, Vocab.Perm.ReadApp)
            .map(r -> r.map(configs -> configs.keySet()))
            .map(MetaDBNotify::setUpdate);
    }

    private Observable<SearchUpdate> appSearch (Session sess, Map<String, String> args)
    {
        log.info("appSearch: {}", args);
        return new SubHandler(sess, args)
            .fromUUID("app", data::appValues, Vocab.Perm.ReadApp)
            .map(r -> r.map(cs -> cs
                .mapKeys(UUID::toString)
                .mapValues(v -> v.toResponse())))
            .map(SearchUpdate::ofResponse);
    }

    private Observable<Response> classMembers (Session sess, Map<String, String> args)
    {
        log.info("classMembers: {}", args);
        return new SubHandler(sess, args)
            .fromUUID("class", data::classMembers, Vocab.Perm.ReadMembers)
            .map(MetaDBNotify::setUpdate);
    }
}
