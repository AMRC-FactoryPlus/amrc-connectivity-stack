/*
 * ACS Fuseki
 * ShEx vocabulary
 * Copyright 2025 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.fuseki;

import org.apache.jena.rdf.model.*;

public class ShEx {
    public static final String NS = "http://www.w3.org/ns/shex#";
    public static String getURI() { return NS; }

    private static Property prop (String p) {
        return ResourceFactory.createProperty(NS + p);
    }
    
    private static Resource iri (String i) {
        return ResourceFactory.createResource(NS + i);
    }

    public static final Resource NodeConstraint     = iri("NodeConstraint");
    public static final Resource TripleConstraint   = iri("TripleConstraint");

    public static final Property predicate          = prop("predicate");
    public static final Property valueExpr          = prop("valueExpr");
    public static final Property values             = prop("values");
}
