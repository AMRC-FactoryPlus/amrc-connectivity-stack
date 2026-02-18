/*
 * ACS Fuseki
 * ShEx ACL evaluator
 * Copyright 2025 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.fuseki;

import java.util.List;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.graph.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.shex.*;

class FPShapeEvaluator {
    final Logger log = LoggerFactory.getLogger(FPShapeEvaluator.class);

    ShexValidator validator;
    ShexSchema schema;
    List<Triple> mayRead;

    public FPShapeEvaluator (ShexSchema schema, List<Triple> mayRead) {
        this.schema = schema;
        this.mayRead = mayRead;

        this.validator = ShexValidator.get();
    }

    public ShexSchema getSchema () { return schema; }
    public List<Triple> getMayRead () { return mayRead; }

    /* Evaluate a request against the ACL */
    public boolean permitted (Graph g, Node s, Node p, Node o) {
        return mayRead.stream()
            .anyMatch(t -> evaluate(t.getSubject(), s, g)
                && evaluate(t.getPredicate(), p, g)
                && evaluate(t.getObject(), o, g));
    }

    /* Evaluate a Node against a Shape */
    boolean evaluate (Node cond, Node target, Graph graph) {
        if (cond.equals(Node.ANY))
            return true;

        var rep = validator.validate(graph, schema, cond, target);
        if (rep.conforms())
            return true;

        log.info("Node {} in {} failed against {}", target, graph, cond);
        rep.forEachReport(r -> log.info("  {}", r));
        return false;
    }
}
