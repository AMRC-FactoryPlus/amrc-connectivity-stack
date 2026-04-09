/*
 * Factory+ service api
 * notify/v2 request filters
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import jakarta.json.*;

import io.reactivex.rxjava3.core.*;

import io.vavr.collection.*;
import io.vavr.control.Option;

import org.eclipse.jetty.http.pathmap.UriTemplatePathSpec;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.util.UrlPath;

interface Filter
{
    Option<Observable<NotifyUpdate>> handleRequest (Session sess, Request request);

    class Path
    {
        private static final Logger log = LoggerFactory.getLogger(Path.class);
        private UriTemplatePathSpec pathSpec;

        public Path (String path)
        {
            pathSpec = new UriTemplatePathSpec("/" + path);
        }

        public Option<Map<String, String>> checkPath (String path)
        {
            var params = pathSpec.getPathParams("/" + path);
            return Option.of(params)
                .map(HashMap::ofAll)
                .map(m -> m.mapValues(UrlPath::decodeURI));
        }
    }

    /* XXX This only supports GET watches for now */
    class Watch implements Filter
    {
        private static final Logger log = LoggerFactory.getLogger(Watch.class);
        private Path path;
        private Handler<NotifyUpdate> handler;

        public Watch (String path, Handler<NotifyUpdate> handler)
        {
            this.path = new Path(path);
            this.handler = handler;
        }

        public Option<Observable<NotifyUpdate>> handleRequest (Session sess, Request sub)
        {
            return Option.some(sub)
                .filter(s -> s.method() == Request.Method.WATCH)
                .map(s -> s.body().getJsonObject("request"))
                .filter(r -> r.getString("method", "GET").equals("GET"))
                .flatMap(r -> path.checkPath(r.getString("url")))
                .map(args -> this.handler.handle(sess, args));
        }
    }

    class Search implements Filter
    {
        private static final Logger log = LoggerFactory.getLogger(Search.class);
        private Path path;
        private Handler<SearchUpdate> handler;

        public Search (String path, Handler<SearchUpdate> handler)
        {
            this.path = new Path(path);
            this.handler = handler;
        }

        public Option<Observable<NotifyUpdate>> handleRequest (Session sess, Request sub)
        {
            return Option.some(sub)
                .filter(s -> s.method() == Request.Method.SEARCH)
                .flatMap(s -> path.checkPath(s.body().getString("parent")))
                .map(args -> buildSearch(this.handler.handle(sess, args)));
        }
        
        /* XXX Filtering not implemented for now */
        private Observable<NotifyUpdate> buildSearch (Observable<SearchUpdate> updates)
        {
            return updates
                /* It doesn't matter what this first item is as long as
                 * it's not a Full update */
                .zipWith(updates.startWithItem(SearchUpdate.notFound()),
                    SearchUpdate::diffFrom)
                .flatMapIterable(l -> l)
                .zipWith(IsFirst.isFirst(), SearchUpdate::toUpdate);
        }
    }
}
