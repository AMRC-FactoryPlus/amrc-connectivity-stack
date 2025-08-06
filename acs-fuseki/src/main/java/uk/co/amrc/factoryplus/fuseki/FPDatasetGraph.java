/*
 * ACS Fuseki
 * DatasetGraph to mark this as needing ACLs
 * Copyright 2025 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.fuseki;

import java.util.Iterator;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.graph.Node;
import org.apache.jena.sparql.core.DatasetGraph;
import org.apache.jena.sparql.core.DatasetGraphWrapper;
import org.apache.jena.sparql.core.DatasetGraphWrapperView;
import org.apache.jena.sparql.core.Quad;

class FPDatasetGraph extends DatasetGraphWrapper {
    class AclDSG extends DatasetGraphWrapper
        implements DatasetGraphWrapperView 
    {
        final Logger log = LoggerFactory.getLogger(AclDSG.class);

        final String principal;

        public AclDSG (DatasetGraph base, String principal) {
            super(base);
            this.principal = principal;
            log.info("Construct for {} base {}", principal, base);
        }

        @Override
        public Iterator<Quad> find (Node g, Node s, Node p, Node o) {
            log.info("FIND: {} {} {} ({}) for {}", s, p, o, g, principal);
            return super.find(g, s, p, o);
        }
    }

    public FPDatasetGraph (DatasetGraph base) {
        super(base);
    }

    public DatasetGraph withAclFor (String principal) {
        return new AclDSG(getBaseForQuery(), principal);
    }
}
