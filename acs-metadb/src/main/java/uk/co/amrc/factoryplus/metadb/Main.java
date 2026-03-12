/*
 * ACS RDF ConfigDB implementation
 * Main entrypoint
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb;

import java.io.IOException;
import java.net.URI;
import java.util.ServiceConfigurationError;

import org.glassfish.grizzly.http.server.HttpServer;
import org.glassfish.jersey.grizzly2.httpserver.GrizzlyHttpServerFactory;
import org.glassfish.jersey.inject.hk2.AbstractBinder;
import org.glassfish.jersey.server.ResourceConfig;
import org.glassfish.jersey.server.ServerProperties;

public final class Main {
    public static void main (String[] args) throws Throwable
    {
        final int port = Integer.parseUnsignedInt(System.getenv("PORT"));
        final String data = System.getenv("DATA_DIR");

        final var app = new Main(port, data);
        app.start();
    }

    private int port;
    private HttpServer server;
    private RdfStore model;

    private Main (int port, String data)
    {
        this.port = port;

        this.model = new RdfStore(data);
        this.server = createServer();
    }

    interface Throws<T> {
        public T get () throws Throwable;
    }

    private static <T> T orSCE(Throws<T> supp, String msg)
    {
        try {
            return supp.get();
        }
        catch (Throwable t) {
            throw new ServiceConfigurationError(msg, t);
        }
    }

    private HttpServer createServer ()
    {
        final URI listen = orSCE(
            () -> new URI("http", null, "0.0.0.0", this.port, "", null, null),
            "Cannot create URI for HTTP server");

        final var model = this.model;
        final var rc = new ResourceConfig()
            .property(ServerProperties.PROCESSING_RESPONSE_ERRORS_ENABLED, true)
            .packages("uk.co.amrc.factoryplus.metadb")
            .register(new AbstractBinder () {
                protected void configure () {
                    bind(model).to(RdfStore.class);
                }
            });

        return GrizzlyHttpServerFactory
            .createHttpServer(listen, rc, false);
    }

    private void start () throws Throwable
    {
        server.start();
    }
}
