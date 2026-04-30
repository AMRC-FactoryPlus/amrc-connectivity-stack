/*
 * ACS RDF ConfigDB implementation
 * Main entrypoint
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.main;

import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.util.ServiceConfigurationError;
import java.util.Set;
import java.util.UUID;

import org.eclipse.jetty.server.*;
import org.eclipse.jetty.server.handler.*;

import org.glassfish.jersey.inject.hk2.AbstractBinder;
import org.glassfish.jersey.server.ContainerFactory;
import org.glassfish.jersey.server.ResourceConfig;
import org.glassfish.jersey.server.ServerProperties;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/* Note we have Java Sets but Vavr Maps and Lists */
import io.vavr.collection.List;
import io.vavr.collection.HashMap;
import io.vavr.control.Option;

import uk.co.amrc.factoryplus.client.FPServiceClient;
import uk.co.amrc.factoryplus.client.FPAuth.Grant;
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

        this.fplus = createServiceClient();
        this.auth = new AuthProvider(fplus);
        this.model = new RdfStore(fplus, auth, dataDir);
        this.server = createServer();
    }

    private FPServiceClient createServiceClient ()
    {
        var fplus = new FPServiceClient();
        
        var acls = HashMap.of(
            "auth_principal", List.of(
                new Grant(Vocab.Perm.ReadApp, Vocab.Target.Registration),
                /* XXX I'm not sure why this is needed? */
                new Grant(Vocab.Perm.ReadApp, Vocab.Target.SparkplugAddr),
                /* XXX These are broader than strictly necessary. */
                new Grant(Vocab.Perm.ReadMembers, Vocab.Target.Wildcard),
                new Grant(Vocab.Perm.ReadSubclasses, Vocab.Target.Wildcard)));

        var resolved = acls
            .mapKeys(fplus::getOptionConf)
            .filterKeys(Option::isDefined)
            .mapKeys(Option::get);

        log.info("Setting bootstrap ACLs to {}", resolved);
        fplus.auth().setBootstrapACLs(resolved);

        return fplus;
    }

    private Server createServer ()
    {
        var server = new Server(port);

        var pingResult = new PingResult(
            Vocab.U_MetaDB, "2.0.0",
            "AMRC", "acs-metadb", "unknown");
        var bindings = new AbstractBinder () {
            protected void configure () {
                bind(model).to(RdfStore.class);
                bind(fplus).to(FPServiceClient.class);
                bind(auth).to(AuthProvider.class);
                bind(pingResult).to(PingResult.class);
            }
        };

        var notify = model.metaNotify()
            .notifyV2()
            .contextHandlerFor(server);

        var webapp = new ResourceConfig()
            .property(ServerProperties.PROCESSING_RESPONSE_ERRORS_ENABLED, true)
            .packages("uk.co.amrc.factoryplus.providers")
            .packages("uk.co.amrc.factoryplus.webapi")
            .packages("uk.co.amrc.factoryplus.metadb.api")
            .register(bindings);
        var webapi = new ContextHandler(
            ContainerFactory.createContainer(Handler.class, webapp), "/");

        var coll = new ContextHandlerCollection();
        coll.addHandler(notify);
        coll.addHandler(webapi);

        var cors = new CrossOriginHandler();
        cors.setAllowedOriginPatterns(Set.of("*"));
        cors.setAllowedMethods(Set.of("GET", "HEAD", "POST", "PUT", "DELETE", "PATCH"));
        cors.setAllowedHeaders(Set.of("authorization","*"));
        cors.setAllowCredentials(true);
        cors.setPreflightMaxAge(Duration.ofDays(1));
        cors.setHandler(coll);

        server.setHandler(cors);

        return server;
    }

    private void start () throws Throwable
    {
        fplus.start();
        auth.start();
        model.start();
        server.start();
    }
}
