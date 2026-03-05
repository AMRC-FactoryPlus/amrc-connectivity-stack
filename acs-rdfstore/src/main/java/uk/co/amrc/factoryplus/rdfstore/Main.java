/*
 * ACS RDF ConfigDB implementation
 * Main entrypoint
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.rdfstore;

import java.io.IOException;
import java.net.URI;
import java.util.ServiceConfigurationError;

import org.glassfish.grizzly.http.server.HttpServer;
import org.glassfish.jersey.grizzly2.httpserver.GrizzlyHttpServerFactory;
import org.glassfish.jersey.inject.hk2.AbstractBinder;
import org.glassfish.jersey.server.ResourceConfig;

import org.apache.jena.query.Dataset;
import org.apache.jena.query.DatasetFactory;
import org.apache.jena.rdf.model.ModelFactory;
import org.apache.jena.rdf.model.Model;
import org.apache.jena.tdb2.TDB2Factory;

public final class Main {
    public static void main (String[] args) throws Throwable
    {
        final int port = Integer.parseUnsignedInt(System.getenv("PORT"));
        final String data = System.getenv("DATA_DIR");

        final var app = new Main(port, data);
        app.start();
    }

    private int port;
    private String data;
    private HttpServer server;
    private Dataset model;

    private Main (int port, String data)
    {
        this.port = port;
        this.data = data;

        this.model = createModel();
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

    /* We build a Dataset out of these named graphs:
     * - G_direct: this is G_direct from the TDB.
     * - G_derived: this is RDFS(G_direct).
     * - default: this is equal to G_derived.
     */
    private Dataset createModel ()
    {
        var tdb     = TDB2Factory.connectDataset(this.data);
        var direct  = tdb.getNamedModel(Vocab.G_direct);
        var rdfs    = ModelFactory.createRDFSModel(direct);

        var ds = DatasetFactory.create(rdfs);
        ds.addNamedModel(Vocab.G_direct, direct);
        ds.addNamedModel(Vocab.G_derived, rdfs);
        return ds;
    }

    private HttpServer createServer ()
    {
        final URI listen = orSCE(
            () -> new URI("http", null, "0.0.0.0", this.port, "", null, null),
            "Cannot create URI for HTTP server");

        final var model = this.model;
        final var rc = new ResourceConfig()
            .packages("uk.co.amrc.factoryplus.rdfstore")
            .register(new AbstractBinder () {
                protected void configure () {
                    bind(model).to(Dataset.class);
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
