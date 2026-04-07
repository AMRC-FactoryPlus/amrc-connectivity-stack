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

import uk.co.amrc.factoryplus.util.UrlPath;

interface Filter
{
    Option<Observable<Update>> handleSession (Session sess, JsonObject request);

    class Path
    {
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
        private Path path;
        private Handler<Observable<Update>> handler;

        public Watch (String path, Handler<Observable<Update>> handler)
        {
            this.path = new Path(path);
            this.handler = handler;
        }

        public Option<Observable<Update>> handleSession (Session sess, JsonObject sub)
        {
            return Option.some(sub)
                .filter(s -> s.getString("method").equals("WATCH"))
                .map(s -> s.getJsonObject("request"))
                .filter(r -> r.getString("method", "GET").equals("GET"))
                .flatMap(r -> path.checkPath(r.getString("url")))
                .map(args -> this.handler.handle(sess, args));
        }
    }
}
