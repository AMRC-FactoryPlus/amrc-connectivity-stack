/*
 * Factory+ service API
 * notify/v2 support
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.notify;

import java.util.UUID;
import java.util.function.Supplier;

import jakarta.json.*;

import io.reactivex.rxjava3.core.*;

import io.vavr.Tuple2;
import io.vavr.collection.*;
import io.vavr.control.Option;

import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.handler.ContextHandler;
import org.eclipse.jetty.websocket.server.WebSocketUpgradeHandler;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.util.UrlPath;
import uk.co.amrc.factoryplus.http.TextWebsocket;

public class NotifyV2
{
    private static final Logger log = LoggerFactory.getLogger(NotifyV2.class);

    public static class Builder
    {
        private List<Filter> filters = List.empty();

        public Builder watch (String path, Handler<Response> handler)
        {
            filters = filters.prepend(new Filter.Watch(path, handler));
            return this;
        }

        public Builder search (String path, Handler<SearchUpdate> handler)
        {
            filters = filters.prepend(new Filter.Search(path, handler));
            return this;
        }

        public NotifyV2 build ()
        {
            return new NotifyV2(filters.reverse());
        }
    }

    private List<Filter> filters;

    private NotifyV2 (List<Filter> filters)
    {
        this.filters = filters;
        log.info("Build NotifyV2: {}", filters);
    }

    public static Builder builder () { return new Builder(); }

    public ContextHandler contextHandlerFor (Server server)
    {
        log.info("Handling WS connections on notify/v2");
        var ch = new ContextHandler("/notify");

        var wsh = WebSocketUpgradeHandler.from(server, ch, 
            cont -> cont.addMapping("/v2",
                (req, res, cb) -> newClientSession()));

        ch.setHandler(wsh);
        return ch;
    }

    private TextWebsocket.Endpoint newClientSession ()
    {
        var sess = new Session(this);
        var ep = new TextWebsocket.Endpoint();

        sess.start(ep.getDuplex());
        return ep;
    }

    public Option<Observable<NotifyUpdate>> findHandler (Session sess, Request req)
    {
        log.info("Finding handler for {}", req);
        return filters.iterator()
            .flatMap(f -> f.handleRequest(sess, req))
            .headOption();
    }
}
