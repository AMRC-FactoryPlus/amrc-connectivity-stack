/*
 * Factory+ RDF store
 * ConfigDB v2/ API
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.rdfstore;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.BiFunction;
import java.util.function.Function;

import jakarta.inject.*;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;

import jakarta.json.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.graph.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.query.*;
import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;
import org.apache.jena.riot.RDFLanguages;
import org.apache.jena.riot.WebContent;
import org.apache.jena.sparql.resultset.SPARQLResult;
import org.apache.jena.update.*;

import io.vavr.control.*;

@Path("v2")
public class ApiV2 {
    @Inject private Dataset dataset;
    @Inject private Request req;

    private static final Logger log = LoggerFactory.getLogger(Sparql.class);

    @GET
    @Path("object")
    public JsonArray listObjects ()
    {
        var objs = dataset.calculateRead(() ->
            dataset.getDefaultModel()
                .listObjectsOfProperty(Vocab.uuid)
                .filterKeep(n -> n.isLiteral())
                .mapWith(o -> o.asLiteral().getValue())
                .toList());

        return Json.createArrayBuilder(objs).build();
    }
}

