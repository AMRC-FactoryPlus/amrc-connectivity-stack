/*
 * ACS RDF ConfigDB implementation
 * Main entrypoint
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.main;

import java.io.IOException;
import java.net.URI;
import java.util.ServiceConfigurationError;

import org.eclipse.jetty.server.*;

//import org.glassfish.grizzly.http.server.HttpServer;
//import org.glassfish.jersey.grizzly2.httpserver.GrizzlyHttpServerFactory;

import org.glassfish.jersey.inject.hk2.AbstractBinder;
import org.glassfish.jersey.server.ContainerFactory;
import org.glassfish.jersey.server.ResourceConfig;
import org.glassfish.jersey.server.ServerProperties;

import uk.co.amrc.factoryplus.metadb.db.Dataflow;
import uk.co.amrc.factoryplus.metadb.db.RdfStore;

public final class Main {
    public static void main (String[] args) throws Throwable
    {
        final int port = Integer.parseUnsignedInt(System.getenv("PORT"));
        final String data = System.getenv("DATA_DIR");

        final var app = new Main(port, data);
        app.start();
    }

    private int port;
    private Server server;
    private RdfStore model;

    private Main (int port, String dataDir)
    {
        this.port = port;

        this.model = new RdfStore(dataDir);
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

    private Server createServer ()
    {
        var server = new Server(port);

        final var model = this.model;
        final var app = new ResourceConfig()
            .property(ServerProperties.PROCESSING_RESPONSE_ERRORS_ENABLED, true)
            .packages("uk.co.amrc.factoryplus.metadb.api")
            .register(new AbstractBinder () {
                protected void configure () {
                    bind(model).to(RdfStore.class);
                }
            });

        var handler = ContainerFactory.createContainer(Handler.class, app);
        server.setHandler(handler);

        return server;
    }

    private void start () throws Throwable
    {
        model.start();
        server.start();
    }
}
