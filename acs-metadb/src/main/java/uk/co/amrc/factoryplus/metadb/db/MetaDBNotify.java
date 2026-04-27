/*
 * Factory+ metadata database
 * Change-notify handling
 * Copyright 2026 University of Sheffield AMRC
 */

/* XXX Should this be in api? */
package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;
import java.util.function.Function;

import jakarta.json.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.reactivex.rxjava3.core.*;
import io.vavr.collection.*;
import io.vavr.control.*;

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
            .watch("v2/app/{app}/object/{object}", this::configWatch)
            .watch("v2/class/{class}/{relation}/", this::classRelation)
            .watch("v2/class/{class}/direct/{relation}/", this::classDirectRelation)
            .build();
    }

    public NotifyV2 notifyV2 () { return notify; }

    private static <U> Response<JsonValue> setUpdate (Response<Set<U>> src)
    {
        return src
            .map(s -> s.map(u -> u.toString()))
            .map(s -> s.foldLeft(Json.createArrayBuilder(), (a, v) -> a.add(v))
                .build());
    }

    private record SubHandler (Session sess, Map<String, String> args)
    {
        public static <T> Observable<Response<T>> invalid ()
        {
            return Observable.just(Response.of(410));
        }

        public Option<UUID> findUUID (String arg)
        {
            return args.get(arg)
                .flatMap(Decoders::parseUUID);
        }

        public <T> Observable<Response<T>> fromUUID (
            String arg,
            Function<UUID, Observable<T>> factory,
            UUID permission)
        {
            return findUUID(arg)
                .map(uuid -> factory.apply(uuid)
                    .compose(sess.applyACL(permission, uuid)))
                .getOrElse(SubHandler::invalid);
        }

        public Option<Relation.Bound> bindRelation (
            UUID uuid, String rarg, boolean asClass, boolean direct)
        {
            return args.get(rarg)
                .flatMap(Relation::find)
                .map(r -> r.bind(uuid, asClass, direct));
        }
        
        public Observable<Response<JsonValue>> fromRelation (
            String oarg, String rarg, boolean asClass, boolean direct,
            Function<Relation.Bound, Observable<Set<UUID>>> factory)
        {
            return findUUID(oarg)
                .flatMap(u -> bindRelation(u, rarg, asClass, direct))
                .map(bound -> factory.apply(bound)
                    .compose(sess.applyACL(bound.perm(), bound.uuid()))
                    .map(MetaDBNotify::setUpdate))
                .getOrElse(SubHandler::invalid);
        }
    }

    /* XXX These app endpoints will return empty maps for nonexistent
     * apps. I think the ConfigDB returned 404s if the app had no
     * configs, which is also not correct. Probably appValues needs to
     * return an Observable<Option<Map>>. */

    private Observable<Response<JsonValue>> appList (
        Session sess, Map<String, String> args)
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

    private Observable<Response<JsonValue>> configWatch (
        Session sess, Map<String, String> args)
    {
        log.info("configWatch: {}", args);
        var sh = new SubHandler(sess, args);
        return sh.findUUID("object")
            .map(obj -> sh.fromUUID("app", data::appValues, Vocab.Perm.ReadApp)
                .map(r -> r.flatMap(cs -> cs
                    .get(obj)
                    .map(v -> v.toResponse())
                    .getOrElse(Response::empty))))
            .getOrElse(SubHandler::invalid);
    }

    private Observable<Response<JsonValue>> classRelation (
        Session sess, Map<String, String> args)
    {
        log.info("classRelation: {}", args);
        return new SubHandler(sess, args)
            .fromRelation("class", "relation", true, false, data::relation);
    }

    private Observable<Response<JsonValue>> classDirectRelation (
            Session sess, Map<String, String> args)
    {
        log.info("classDirectRelation: {}", args);
        return new SubHandler(sess, args)
            .fromRelation("class", "relation", true, true, data::relation);
    }
}
