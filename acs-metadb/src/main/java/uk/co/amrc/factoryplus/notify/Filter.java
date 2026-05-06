/*
 * Factory+ service api
 * notify/v2 request filters
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import java.util.concurrent.TimeUnit;

import jakarta.json.*;

import io.reactivex.rxjava3.core.*;

import io.vavr.collection.*;
import io.vavr.control.Option;

import org.eclipse.jetty.http.pathmap.UriTemplatePathSpec;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.util.Response;
import uk.co.amrc.factoryplus.util.UrlPath;

interface Filter
{
    Option<Observable<NotifyUpdate>> handleRequest (Session sess, Request request);

    /* We need to rate-control our notify output, otherwise we get
     * massive churn when we load a lot of data. It is important this is
     * applied to a level-triggered sequence as it will drop
     * notifications. It's possible the 10s throttle timeout might be
     * too long. */
    public static <T> Observable<T> rateControl (Observable<T> src)
    {
        return src
            .throttleLatest(10, TimeUnit.SECONDS, true)
            .distinctUntilChanged();
    }

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
        private Handler<Response<JsonValue>> handler;

        public Watch (String path, Handler<Response<JsonValue>> handler)
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
                .map(args -> buildWatch(this.handler.handle(sess, args)));
        }

        private Observable<NotifyUpdate> buildWatch (
            Observable<Response<JsonValue>> resps)
        {
            return resps
                .compose(Filter::rateControl)
                .zipWith(IsFirst.isFirst(), NotifyUpdate::ofResponse);
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
            var src = updates.compose(Filter::rateControl);
            return src
                /* It doesn't matter what this first item is as long as
                 * it's not a Full update */
                .zipWith(src.startWithItem(SearchUpdate.notFound()),
                    SearchUpdate::diffFrom)
                .flatMapIterable(l -> l)
                .zipWith(IsFirst.isFirst(), SearchUpdate::toUpdate);
        }
    }
}
