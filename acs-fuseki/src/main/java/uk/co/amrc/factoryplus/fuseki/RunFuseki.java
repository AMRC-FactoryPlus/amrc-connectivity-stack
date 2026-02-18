/*
 * ACS Fuseki server
 * Main entry point
 * Copyright 2025 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.fuseki;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.fuseki.Fuseki;
import org.apache.jena.fuseki.main.FusekiServer;
import org.apache.jena.fuseki.main.cmds.FusekiMain;
import org.apache.jena.fuseki.main.sys.FusekiModules;
import org.apache.jena.fuseki.server.Operation;
import org.apache.jena.sparql.util.Symbol;
import org.apache.jena.sys.JenaSystem;

public class RunFuseki {
    static final Logger log = LoggerFactory.getLogger(RunFuseki.class);

    static {
        JenaSystem.init();
    }

    public static void main(String ...args) {
        log.info("Building Fuseki server");

        FusekiServer server = build(args).build();

        try {
            server.start();
            log.info("Started server");
            server.join();
        }
        catch (RuntimeException ex) {
            ex.printStackTrace();
        }
        finally { server.stop(); }
    }

    public static FusekiServer.Builder build(String ...args) {

        FusekiModules modules = FusekiModules.create(
            new FPAclModule());

        FusekiServer.Builder builder =
            FusekiMain.builder(args)
                .fusekiModules(modules);
        return builder;
    }
}
