/*
 * Factory+ metadata database
 * Random utility functions
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.io.StringReader;
import java.util.Iterator;
import java.util.function.Function;
import java.util.function.Supplier;

import jakarta.json.*;

import org.apache.jena.query.ResultSet;
import org.apache.jena.rdf.model.*;
import org.apache.jena.util.iterator.ClosableIterator;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.vavr.*;
import io.vavr.control.*;

final class Util {
    private static final Logger log = LoggerFactory.getLogger(Util.class);

    private static Throwable error (String fmt, Object... args)
    {
        String msg = String.format(fmt, args);
        return new Err.CorruptRDF(msg);
    }

    /* This will silently ignore trailing garbage. I think this could be
     * cured by using JsonParser instead but it's not straightforward. */
    public static Option<JsonValue> readJson (String json)
    {
        var sr = new StringReader(json);
        var jr = Json.createReader(sr);

        return Try.of(jr::readValue)
            .andFinally(jr::close)
            .toOption();
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

    public static <T> Option<T> single (Iterator<T> it)
    {
        if (!it.hasNext())
            return Option.none();
        var rv = it.next();

        if (it.hasNext()) {
//            if (it instanceof ClosableIterator)
//                ((ClosableIterator)it).close();
//            /* Annoying failure to implement the appropriate interface… */
//            if (it instanceof ResultSet)
//                ((ResultSet)it).close();

            /* rather than closing early, log the results */
            log.info("Expected single result: {}", rv);
            it.forEachRemaining(v -> log.info("Unexpected extra result: {}", v));

            throw new Err.CorruptRDF("Expected single result, found multiple");
        }

        return Option.some(rv);
    }

    public static <T> T singleOrError (Iterator<T> it)
    {
        return single(it)
            .getOrElseThrow(() -> 
                new Err.CorruptRDF("Expected single result, found nothing"));
    }
}
