/*
 * ACS Fuseki
 * Fuseki module to set up our datasets
 * Copyright 2025 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.fuseki;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.fuseki.main.sys.FusekiModule;
import org.apache.jena.fuseki.server.DataAccessPoint;
import org.apache.jena.fuseki.server.Operation;
import org.apache.jena.rdf.model.Model;

class FPAclModule implements FusekiModule {
    static final Logger log = LoggerFactory.getLogger(FPAclModule.class);

    public FPAclModule () {
        log.info("Construct FPAclModule");
    }

    @Override
    public String name () { return "ACS Factory+ ACLs"; }

    @Override
    public void configDataAccessPoint (DataAccessPoint dap, Model m) {
        log.info("Found DAP {}", dap.getName());
        
        var srv = dap.getDataService();
        var ds = srv.getDataset();
        log.info("Found DS class {}", ds.getClass());
        if (!(ds instanceof FPDatasetGraph)) {
            log.info("Not an FPDatasetGraph, skipping");
            return;
        }

        var sparql = new FPQuerySparql();
        srv.getEndpoints(Operation.Query).forEach(e -> e.setProcessor(sparql));
        log.info("Set up SPARQL operations");
    }
}
