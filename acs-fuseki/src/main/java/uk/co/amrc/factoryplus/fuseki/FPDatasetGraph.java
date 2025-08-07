/*
 * ACS Fuseki
 * DatasetGraph to mark this as needing ACLs
 * Copyright 2025 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.fuseki;

import java.util.Iterator;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.graph.Graph;
import org.apache.jena.graph.Node;
import org.apache.jena.riot.system.PrefixMap;
import org.apache.jena.sparql.core.DatasetGraph;
import org.apache.jena.sparql.core.DatasetGraphWrapper;
import org.apache.jena.sparql.core.DatasetGraphWrapperView;
import org.apache.jena.sparql.core.DatasetGraphQuads;
import org.apache.jena.sparql.core.GraphView;
import org.apache.jena.sparql.core.Quad;

class FPDatasetGraph extends DatasetGraphWrapper {
    class AclDSG extends DatasetGraphWrapper
            implements DatasetGraphWrapperView
    {
        final Logger log = LoggerFactory.getLogger(AclDSG.class);

        final String principal;
        final FPShapeBuilder shapes;

        public AclDSG (DatasetGraph base, String principal) {
            super(base);
            this.principal = principal;
            /* Grants must always be in the default graph. Grants in
             * other graphs are hypothetical and not active. */
            this.shapes = new FPShapeBuilder(base.getDefaultGraph());
            log.info("Construct for {} base {}", principal, base);
        }

        @Override
        protected DatasetGraph get () {
            log.info("get");

            if (!shapes.hasSchema()) {
                shapes.withPrincipal(principal)
                    .buildSchema();
                log.info("Built schema for {}", principal);
                log.info("Shapes:");
                shapes.getSchema().getShapes()
                    .forEach(s -> log.info("  {}", s));
                log.info("Triples (may read):");
                shapes.getMayRead()
                    .forEach(t -> log.info("  {}", t));
            }

            return super.get();
        }

        @Override
        public Graph getDefaultGraph () {
            log.info("getDefaultGraph");
            return GraphView.createDefaultGraph(this);
        }

        @Override
        public Graph getUnionGraph () {
            log.info("getUnionGraph");
            return GraphView.createUnionGraph(this);
        }

        @Override
        public Graph getGraph (Node g) {
            log.info("getGraph {}", g);
            return GraphView.createNamedGraph(this, g);
        }

        @Override public boolean containsGraph (Node g) { return true; }

        @Override
        public Iterator<Quad> find (Node g, Node s, Node p, Node o) {
            log.info("FIND: {} {} {} ({}) for {}", s, p, o, g, principal);
            return super.find(g, s, p, o);
        }

        @Override
        public Iterator<Quad> findNG (Node g, Node s, Node p, Node o) {
            log.info("FIND NG: {} {} {} ({}) for {}", s, p, o, g, principal);
            return super.findNG(g, s, p, o);
        }
    }

    public FPDatasetGraph (DatasetGraph base) {
        super(base);
    }

    public DatasetGraph withAclFor (String principal) {
        return new AclDSG(getBaseForQuery(), principal);
    }
}
