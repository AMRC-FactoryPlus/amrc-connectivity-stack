/*
 * Factory+ RDF store
 * SPARQL query endpoints
 * Copyright 2026 University of Sheffield AMRC
 */ 

package uk.co.amrc.factoryplus.metadb;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.BiFunction;
import java.util.function.Function;

import jakarta.inject.*;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;

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
public class Sparql {
    @Inject private RdfStore store;
    @Inject private Request req;
    @Inject private UriInfo uriInfo;

    private static final Logger log = LoggerFactory.getLogger(Sparql.class);

    private static final List<Variant> RS_TYPES = buildVariants(
        "application/sparql-results+json",
        "application/json",
        "text/csv",
        "text/tab-separated-values",
        "application/sparql-results+xml",
        "application/xml");
    private static final List<Variant> RDF_TYPES = buildVariants(
        "text/turtle",
        "application/n-triples",
        "application/rdf+json",
        "application/ld+json",
        "application/rdf+xml",
        "application/trig",
        "application/n-quads");

    private static List<Variant> buildVariants (String... types)
    {
        return io.vavr.collection.List.of(types)
            .map(MediaType::valueOf)
            .map(t -> new Variant(t, (String)null, null))
            .asJava();
    }

    private static record ContentHandler (
        List<Variant> accept,
        Function<String, Lang> ctToLang)
    {
        public Lang acceptLang (Request req) throws WebApplicationException
        {
            return Optional.ofNullable(req.selectVariant(accept))
                .map(v -> v.getMediaType().toString())
                .map(ctToLang)
                .orElseThrow(() -> new WebApplicationException(406));
        }

        public Lang contentLang (String ct) throws WebApplicationException
        {
            var lang = ctToLang.apply(ct);
            if (lang == null)
                throw new WebApplicationException(415);
            return lang;
        }
    }

    private static final ContentHandler RS_HANDLER = 
        new ContentHandler(RS_TYPES, WebContent::contentTypeToLangResultSet);
    private static final ContentHandler RDF_HANDLER =
        new ContentHandler(RDF_TYPES, RDFLanguages::contentTypeToLang);

    private static record QueryHandler (
        ContentHandler content,
        BiFunction<QueryExecution, Lang, StreamingOutput> handle) { };

    private static Map<QueryType, QueryHandler> HANDLERS = Map.of(
        QueryType.ASK,
        new QueryHandler(RS_HANDLER,
            (qe, l) -> {
                boolean rs = qe.execAsk();
                return os -> ResultSetFormatter.output(os, rs, l);
            }),
        QueryType.SELECT,
        new QueryHandler(RS_HANDLER,
            (qe, l) -> {
                ResultSet rs = qe.execSelect().materialise();
                return os -> ResultSetFormatter.output(os, rs, l);
            }),
        QueryType.CONSTRUCT,
        new QueryHandler(RDF_HANDLER,
            (qe, l) -> {
                /* We need to copy the results while we are inside the
                 * transaction. The execConstruct method returns a Model
                 * which is only valid within the txn. */
                var trips = qe.execConstructTriples();
                var rs = GraphMemFactory.createDefaultGraph();
                GraphUtil.add(rs, trips);
                return os -> RDFDataMgr.write(os, rs, l);
            }));

    @POST @Path("sparql")
    @Consumes("application/sparql-update")
    public void update (String update)
    {
        store.executeWrite(() ->
            UpdateAction.parseExecute(update, store.dataset()));
    }

    @POST @Path("sparql")
    @Consumes("application/sparql-query")
    public StreamingOutput sparql (String queryString) throws WebApplicationException
    {
        var query = Try.of(() -> QueryFactory.create(queryString))
            .getOrElseThrow(e -> new WebApplicationException(400));

        QueryHandler handler = HANDLERS.get(query.queryType());
        if (handler == null)
            throw new WebApplicationException(422);

        var lang = handler.content().acceptLang(req);

        return store.calculateRead(() -> {
            try (var qexec = QueryExecutionFactory.create(query, store.dataset())) {
                return handler.handle().apply(qexec, lang);
            }
        });
    }

    @GET @Path("sparql")
    public StreamingOutput sparqlGet (@QueryParam("query") String qs)
    {
        return sparql(qs);
    }

    @POST @Path("sparql")
    @Consumes("application/x-www-form-urlencoded")
    public StreamingOutput sparqlForm (@FormParam("query") String qs)
    {
        return sparql(qs);
    }

    private Model resolveGraph (boolean create)
    {
        var dataset = store.dataset();
        var headers = uriInfo.getQueryParameters();
        var isDef = headers.getFirst("default");
        var graph = headers.getFirst("graph");

        if (isDef != null) {
            if (graph != null || isDef != "")
                throw new WebApplicationException(400);
            return dataset.getDefaultModel();
        }

        if (graph == null || graph == "")
            throw new WebApplicationException(400);
        if (!create && !dataset.containsNamedModel(graph))
            throw new WebApplicationException(404);
        return dataset.getNamedModel(graph);
    }

    @GET @Path("rdf")
    public StreamingOutput graphGet ()
    {
        var dataset = store.dataset();
        var lang = RDF_HANDLER.acceptLang(req);
        var graph = resolveGraph(false);

        /* We must do explict txn handling here as otherwise we will
         * need to copy the complete graph in memory. */
        dataset.begin(TxnType.READ);
        return os -> {
            try {
                RDFDataMgr.write(os, graph, lang);
            }
            finally {
                dataset.end();
            }
        };
    }

    /* TXN */
    private void readToGraph (Model graph, InputStream rdf, Lang lang)
    {
        try {
            RDFDataMgr.read(graph, rdf, lang);
        }
        catch (Throwable e) {
            var res = Response.status(422)
                .type("text/plain")
                .entity(e.getMessage() + "\r\n")
                .build();
            throw new WebApplicationException(res); 
        }
    }

    @POST @Path("rdf")
    public void graphPost (
        InputStream rdf,
        @HeaderParam("content-type") String type)
    {
        var lang = RDF_HANDLER.contentLang(type);
        var graph = resolveGraph(true);

        store.executeWrite(() -> {
            readToGraph(graph, rdf, lang);
            /* This refreshes the inferences because we have been poking
             * around behind its back. Strictly this is only needed when
             * we load to a graph which is a source for the inference,
             * but graph load will not be a common operation. */
            store.derived().rebind();
        });
    }

    @PUT @Path("rdf")
    public void graphPut (
        InputStream rdf,
        @HeaderParam("content-type") String type)
    {
        var lang = RDF_HANDLER.contentLang(type);
        var graph = resolveGraph(true);

        store.executeWrite(() -> {
            graph.removeAll();
            readToGraph(graph, rdf, lang);
            store.derived().rebind();
        });
    }
}
