/*
 * ACS RDF ConfigDB implementation
 * Main entrypoint
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.main;

import java.io.IOException;
import java.net.URI;
import java.util.ServiceConfigurationError;
import java.util.UUID;

import org.eclipse.jetty.server.*;
import org.eclipse.jetty.server.handler.*;

import org.glassfish.jersey.inject.hk2.AbstractBinder;
import org.glassfish.jersey.server.ContainerFactory;
import org.glassfish.jersey.server.ResourceConfig;
import org.glassfish.jersey.server.ServerProperties;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.client.*;
import uk.co.amrc.factoryplus.providers.*;
import uk.co.amrc.factoryplus.metadb.db.*;

public final class Main {
    private static final Logger log = LoggerFactory.getLogger(Main.class);

    public static void main (String[] args) throws Throwable
    {
        final int port = Integer.parseUnsignedInt(System.getenv("PORT"));
        final String data = System.getenv("DATA_DIR");

        final var app = new Main(port, data);
        app.start();
    }

    private int port;
    private FPServiceClient fplus;
    private Server server;
    private RdfStore model;
    private AuthProvider auth;

    private Main (int port, String dataDir)
    {
        this.port = port;

        this.fplus = new FPServiceClient();
        this.model = new RdfStore(fplus, dataDir);
        this.auth = new AuthProvider(fplus);
        this.server = createServer();
    }

    interface Throws<T> {
        public T get () throws Throwable;
    }

    private Server createServer ()
    {
        var server = new Server(port);

        var pingResult = new PingResult(
            Vocab.U_RDFStore, "2.0.0",
            "AMRC", "acs-metadb", "unknown");
        var bindings = new AbstractBinder () {
            protected void configure () {
                bind(model).to(RdfStore.class);
                bind(fplus).to(FPServiceClient.class);
                bind(auth).to(AuthProvider.class);
                bind(pingResult).to(PingResult.class);
            }
        };

        var v2app = new ResourceConfig()
            .property(ServerProperties.PROCESSING_RESPONSE_ERRORS_ENABLED, true)
            .packages("uk.co.amrc.factoryplus.providers")
            .packages("uk.co.amrc.factoryplus.metadb.api")
            .register(bindings);
        var v2api = new ContextHandler(
            ContainerFactory.createContainer(Handler.class, v2app), "/v2");

        var notify = model.metaNotify()
            .notifyV2()
            .contextHandlerFor(server);
        var webapp = new ResourceConfig()
            .property(ServerProperties.PROCESSING_RESPONSE_ERRORS_ENABLED, true)
            .packages("uk.co.amrc.factoryplus.providers")
            .packages("uk.co.amrc.factoryplus.webapi")
            .register(bindings);
        var webapi = new ContextHandler(
            ContainerFactory.createContainer(Handler.class, webapp), "/");

        var coll = new ContextHandlerCollection();
        coll.addHandler(v2api);
        coll.addHandler(notify);
        coll.addHandler(webapi);

        server.setHandler(coll);

        return server;
    }

    private void start () throws Throwable
    {
        fplus.start();
        model.start();
        server.start();
    }
}
