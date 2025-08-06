/*
 * ACS Fuseki
 * SPARQL query ACL wrapper
 * Copyright 2025 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.fuseki;

import java.util.Base64;
import java.nio.charset.StandardCharsets;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.atlas.lib.Pair;
import org.apache.jena.fuseki.servlets.ActionService;
import org.apache.jena.fuseki.servlets.HttpAction;
import org.apache.jena.fuseki.servlets.SPARQL_QueryDataset;
import org.apache.jena.query.Query;
import org.apache.jena.query.QueryExecution;
import org.apache.jena.sparql.core.DatasetGraph;

public class FPQuerySparql extends SPARQL_QueryDataset {
    final Logger log = LoggerFactory.getLogger(FPQuerySparql.class);

    @Override
    protected Pair<DatasetGraph, Query> decideDataset 
        (HttpAction action, Query query, String queryStringLog)
    {
        var princ = findPrincipal(action);
        log.info("decideDataset for {}", princ);

        var ds = (FPDatasetGraph)getDataset(action);
        var ads = ds.withAclFor(princ);

        return Pair.create(ads, query);
    }

    private String findPrincipal (HttpAction action) {
        var auth = action.getRequest().getHeader("Authorization");
        log.info("Auth: {}", auth);

        var parts = auth.split("\\s");
        if (parts.length != 2) {
            log.error("Got {} parts to auth", parts.length);
            return null;
        }
        if (!parts[0].equalsIgnoreCase("basic")) {
            log.error("Got {} HTTP auth", parts[0]);
            return null;
        }

        var bcreds = Base64.getDecoder().decode(parts[1]);
        var creds = new String(bcreds, StandardCharsets.UTF_8);
        log.info("Creds: {}", creds);
        var up = creds.split(":");

        if (up.length != 2) {
            log.error("Got {} creds", up.length);
            return null;
        }
        /* XXX We are not doing this properly yet. Accept any password. */
        return up[0];
    }
}
