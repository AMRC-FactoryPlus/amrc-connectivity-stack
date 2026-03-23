/*
 * Factory+ metadata database
 * Random utility functions
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.Iterator;
import java.util.Optional;

import org.apache.jena.query.ResultSet;
import org.apache.jena.rdf.model.*;
import org.apache.jena.util.iterator.ClosableIterator;

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

    public static <T> Optional<T> single (Iterator<T> it)
    {
        if (!it.hasNext())
            return Optional.empty();
        var rv = it.next();

        if (it.hasNext()) {
            if (it instanceof ClosableIterator)
                ((ClosableIterator)it).close();
            /* Annoying failure to implement the appropriate interface… */
            if (it instanceof ResultSet)
                ((ResultSet)it).close();

            throw new Err.CorruptRDF("Expected single result, found multiple");
        }

        return Optional.of(rv);
    }

    public static <T> T singleOrError (Iterator<T> it)
    {
        return single(it)
            .orElseThrow(() -> 
                new Err.CorruptRDF("Expected single result, found nothing"));
    }
}
