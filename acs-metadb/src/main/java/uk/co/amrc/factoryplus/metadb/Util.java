/*
 * Factory+ metadata database
 * Random utility functions
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb;

import org.apache.jena.rdf.model.*;

import io.vavr.*;
import io.vavr.control.*;

final class Util {
    private static Throwable error (String fmt, Object... args)
    {
        String msg = String.format(fmt, args);
        return new Err.CorruptRDF(msg);
    }

    public static <T> T decodeLiteral (RDFNode node, Resource type, 
        CheckedFunction1<String, T> extract)
    {
        return Try.success(node)
            .map(n -> n.asLiteral())
            .filter(l -> l.getDatatypeURI().equals(type.getURI()),
                l -> error("Incorrect literal type (%s vs %s)",
                    l.getDatatypeURI(), type.getURI()))
            .flatMap(l -> Try.success(l.getString())
                .mapTry(extract)
                .recoverWith(e -> {
                    return Try.failure(error("Bad literal"));
                }))
            .get();
    }
}
