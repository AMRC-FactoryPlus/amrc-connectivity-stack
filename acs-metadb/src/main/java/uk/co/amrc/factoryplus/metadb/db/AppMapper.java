/*
 * Factory+ metadata database
 * Structured application mapper
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

import jakarta.json.*;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.update.*;
import org.apache.jena.vocabulary.*;

import io.vavr.control.Try;

public class AppMapper {
    /* Specific updaters for individual Apps. These should be replaced
     * with queries generated from schema entries. */

    private static final Query Q_objectRegistration = Vocab.query("""
        select ?uuid ?rank ?class ?owner ?strict ?deleted
        where {
            ?obj <core/uuid> ?uuid.
            optional {
                ?obj rdf:type/<core/rank> ?rank;
                    <core/primary>/<core/uuid> ?class.
            }

            optional { ?obj <core/owner>/<core/uuid> ?1. }
            bind(coalesce(?1, "091e796a-65c0-4080-adff-c3ce01a65b2e") as ?owner)

            optional { ?obj <core/deleted> ?2. }
            bind(coalesce(?2, false) as ?deleted)

            bind(true as ?strict)
        }
    """);

    private static final Query Q_generalInfo = Vocab.query("""
        select ?name
        where {
            ?obj <core/name> ?name.
        }
    """);

    private static final UpdateRequest U_generalInfo = Vocab.update("""
        delete { ?obj <core/name> ?1. }
        insert { ?obj <core/name> ?name. }
        where { ?obj <core/name> ?1. }
    """);

    

    /* We have to bypass Jena's RDFDatatype system here and provide our
     * own mappings. We cannot map arbitrary objects to JSON, and the
     * JSON creation functions will not accept Object. */
    private static final Map<Resource, 
            Function<String, Optional<JsonValue>>> toJson = Map.of(
        XSD.xstring,    s -> Optional.of(Json.createValue(s)),
        XSD.xint,       s -> Try.of(() -> Integer.parseInt(s))
                                .toJavaOptional()
                                .map(Json::createValue),
        XSD.xboolean,   s -> s.equals("true") ? Optional.of(JsonValue.TRUE)
                            : s.equals("false") ? Optional.of(JsonValue.FALSE)
                            : Optional.empty(),
        RDF.JSON,       Util::readJson);

    private RdfStore db;
    private Map<Resource, Query> generators = Map.of(
        Vocab.Registration,     Q_objectRegistration,
        Vocab.Info,             Q_generalInfo);

    public AppMapper (RdfStore db)
    {
        this.db = db;
    }

    public Optional<JsonValue> generateConfig (Resource app, Resource obj)
    {
        return Optional.ofNullable(generators.get(app))
            .flatMap(q -> db.optionalQuery(q, "obj", obj))
            .map(AppMapper::solutionToJson);
    }

    /* Currently this does dynamic decoding based on what was returned
     * from the RDF. Once we have query generation we should be able to
     * use the <core/to> properties to know what we are expecting. */
    private static JsonValue literalToJson (RDFNode node)
    {
        /* This should probably be selected based on optional/nullable
         * properties in the schema. */
        if (node == null) return JsonValue.NULL;

        if (!node.isLiteral())
            throw new Err.NotLiteral(node);
        
        var lit = node.asLiteral();
        var typ = ResourceFactory.createResource(lit.getDatatypeURI());

        return Optional.ofNullable(toJson.get(typ))
            .flatMap(d -> d.apply(lit.getLexicalForm()))
            .orElseThrow(() -> new Err.BadLiteral(lit));
    }

    private static JsonValue solutionToJson (QuerySolution rs)
    {
        var jobj = Json.createObjectBuilder();
        rs.varNames().forEachRemaining(n ->
            jobj.add(n, literalToJson(rs.get(n))));

        return jobj.build();
    }
}
