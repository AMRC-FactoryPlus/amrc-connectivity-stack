/*
 * ACS Fuseki
 * DatasetGraph to mark this as needing ACLs
 * Copyright 2025 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.fuseki;

import java.util.Iterator;
import java.util.Optional;
import java.util.stream.Stream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.atlas.iterator.Iter;
import org.apache.jena.graph.Graph;
import org.apache.jena.graph.Node;
import org.apache.jena.riot.system.PrefixMap;
import org.apache.jena.sparql.core.DatasetGraph;
import org.apache.jena.sparql.core.DatasetGraphWrapper;
import org.apache.jena.sparql.core.DatasetGraphWrapperView;
import org.apache.jena.sparql.core.GraphView;
import org.apache.jena.sparql.core.Quad;

class FPDatasetGraph extends DatasetGraphWrapper
    implements DatasetGraphWrapperView
{
    final Logger log = LoggerFactory.getLogger(FPDatasetGraph.class);

    final String principal;
    private Optional<FPShapeEvaluator> maybeShapes;

    /* This class is to hold the base DSG until we know what principal
     * we will use. */
    static class Builder extends DatasetGraphWrapper {
        public Builder (DatasetGraph base) {
            super(base);
        }

        public DatasetGraph withPrincipal (String principal) {
            return new FPDatasetGraph(getBaseForQuery(), principal);
        }
    }

    private FPDatasetGraph (DatasetGraph base, String principal) {
        super(base);
        this.principal = principal;
        this.maybeShapes = Optional.empty();
        log.info("Construct for {} base {}", principal, base);
    }

    public static DatasetGraph withBase (DatasetGraph base) {
        return new Builder(base);
    }

    @Override
    protected DatasetGraph get () {
        log.info("get");
        var ds = super.get();

        if (maybeShapes.isEmpty()) {
            /* Grants must always be in the default graph. Grants in
             * other graphs are hypothetical and not active. */
            var shapes = new FPShapeBuilder(ds.getDefaultGraph())
                .withPrincipal(principal)
                .build();
            log.info("Built schema for {}", principal);
            log.info("  Shapes:");
            shapes.getSchema().getShapes()
                .forEach(s -> log.info("    {}", s));
            log.info("  Triples (may read):");
            shapes.getMayRead()
                .forEach(t -> log.info("    {}", t));
            maybeShapes = Optional.of(shapes);
        }

        return ds;
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

    private Stream<Quad> stream1 (boolean ng, Node g, Node s, Node p, Node o) {
        log.info("FIND: {} {} {} in {} ({}) for {}", 
            s, p, o, g, ng, principal);
        var shapes = maybeShapes.orElseThrow();
        var base = get();
        /* XXX I have no idea if this is right. I am not thinking too
         * hard about default graph semantics right now. */
        var graph = ng ? base.getGraph(g) : base.getDefaultGraph();

        return Iter.asStream(ng ? super.findNG(g, s, p, o) : super.find(g, s, p, o))
            .filter(q -> shapes.permitted(graph, 
                q.getSubject(), q.getPredicate(), q.getObject()));
    }

    @Override
    public Iterator<Quad> find (Node g, Node s, Node p, Node o) {
        return stream1(false, g, s, p, o).iterator();
    }

    @Override
    public Iterator<Quad> findNG (Node g, Node s, Node p, Node o) {
        return stream1(true, g, s, p, o).iterator();
    }

    @Override
    public Stream<Quad> stream (Node g, Node s, Node p, Node o) {
        return stream1(false, g, s, p, o);
    }
}
