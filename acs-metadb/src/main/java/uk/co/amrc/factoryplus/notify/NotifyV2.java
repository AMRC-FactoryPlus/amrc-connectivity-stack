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

    public record SearchProvider (
        Supplier<Option<Map<String, Response>>> full,
        Observable<Tuple2<String, Response>> updates,
        Observable<Boolean> acl)
    { }

    public static class Builder
    {
        private List<Filter> filters = List.empty();

        public Builder watch (String path, Handler<Observable<Update>> handler)
        {
            filters.prepend(new Filter.Watch(path, handler));
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
    }

    public static Builder builder () { return new Builder(); }

    public ContextHandler buildHandlerFor (Server server)
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
        var ep = new TextWebsocket.Endpoint();
        var sess = new Session(this, ep.getDuplex());

        sess.start();
        return ep;
    }
}
