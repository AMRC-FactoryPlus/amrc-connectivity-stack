/*
 * ACS Fuseki
 * RDF vocabulary
 * Copyright 2025 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.fuseki;

import org.apache.jena.rdf.model.*;

public class Vocab {
    public static final String NS = "http://factoryplus.app.amrc.co.uk/rdf/2025-05/ac-24-611/acl#";
    public static String getURI() { return NS; }

    private static Resource iri (String i) {
        return ResourceFactory.createResource(NS + i);
    }
    private static Property prop (String p) {
        return ResourceFactory.createProperty(NS + p);
    }

    public static final Resource ShexCondition       = iri("ShexCondition");

    public static final Property object              = prop("object");
    public static final Property predicate           = prop("predicate");
    public static final Property readTriple          = prop("readTriple");
    public static final Property subject             = prop("subject");
    public static final Property username            = prop("username");
    public static final Property writeTriple         = prop("writeTriple");
}
