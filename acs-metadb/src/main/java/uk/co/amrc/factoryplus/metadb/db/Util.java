/*
 * Factory+ metadata database
 * Random utility functions
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.io.StringReader;
import java.time.Instant;
import java.util.Iterator;
import java.util.Map;
import java.util.function.Function;
import java.util.function.Supplier;

import jakarta.json.*;

import org.apache.jena.query.ResultSet;
import org.apache.jena.rdf.model.*;
import org.apache.jena.util.iterator.ClosableIterator;
import org.apache.jena.vocabulary.*;

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
    public static Try<JsonValue> tryReadJson (String json)
    {
        var sr = new StringReader(json);
        var jr = Json.createReader(sr);

        return Try.of(jr::readValue)
            .andFinally(jr::close);
    }

    public static Option<JsonValue> readJson (String json)
    {
        return tryReadJson(json).toOption();
    }
    public static JsonValue readJsonOrError (String json)
    {
        return tryReadJson(json).get();
    }

    /* I am just building my own RDF datatype system here. The Jena
     * system does not meet my needs. */
    private record Datatype (
        Resource uri,
        CheckedFunction1<String, Object> decoder)
    { }

    private static Map<Class, Datatype> TYPE_MAP = Map.of(
        JsonValue.class,    new Datatype(RDF.JSON, Util::readJsonOrError),
        String.class,       new Datatype(XSD.xstring, s -> s),
        Instant.class,      new Datatype(XSD.dateTime, Instant::parse),
        Integer.class,      new Datatype(XSD.xint, Integer::parseInt));

    public static <T> T decodeLiteral (RDFNode node, Class<T> klass)
    {
        var dt = Option.of(TYPE_MAP.get(klass))
            .getOrElseThrow(() -> new RuntimeException(
                "RDF decoding requested for unknown type: " + klass));

        return Try.success(node)
            .map(n -> n.asLiteral())
            .filter(l -> l.getDatatypeURI().equals(dt.uri().getURI()),
                l -> error("Incorrect literal type (%s vs %s)",
                    l.getDatatypeURI(), dt.uri().getURI()))
            .flatMap(l -> Try.success(l.getLexicalForm())
                .mapTry(dt.decoder())
                .recoverWith(e -> {
                    return Try.failure(error("Bad literal"));
                }))
            .map(klass::cast)
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
