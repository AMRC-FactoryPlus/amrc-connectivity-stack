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

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.rdf.model.*;
import org.apache.jena.query.*;
import org.apache.jena.riot.Lang;
import org.apache.jena.riot.RDFDataMgr;
import org.apache.jena.riot.RDFLanguages;
import org.apache.jena.riot.WebContent;
import org.apache.jena.sparql.resultset.SPARQLResult;
import org.apache.jena.update.*;

import io.vavr.control.*;

@Path("v2/sparql")
public class Sparql {
    @Inject private Dataset ds;
    @Inject private Request req;

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

    private record Handler (
        List<Variant> accept,
        Function<String, Lang> ctToLang,
        BiFunction<QueryExecution, Lang, StreamingOutput> handle) { };

    private Map<QueryType, Handler> HANDLERS = Map.of(
        QueryType.ASK,
        new Handler(RS_TYPES, WebContent::contentTypeToLangResultSet,
            (qe, l) -> {
                boolean rs = qe.execAsk();
                return os -> ResultSetFormatter.output(os, rs, l);
            }),
        QueryType.SELECT,
        new Handler(RS_TYPES, WebContent::contentTypeToLangResultSet,
            (qe, l) -> {
                ResultSet rs = qe.execSelect().materialise();
                return os -> ResultSetFormatter.output(os, rs, l);
            }),
        QueryType.CONSTRUCT,
        new Handler(RDF_TYPES, RDFLanguages::contentTypeToLang,
            (qe, l) -> {
                Model rs = qe.execConstruct();
                return os -> RDFDataMgr.write(os, rs, l);
            }));

    @POST
    @Consumes("application/sparql-update")
    public void update (String update)
    {
        UpdateAction.parseExecute(update, ds);
    }

    @POST
    @Consumes("application/sparql-query")
    public StreamingOutput sparql (String queryString) throws WebApplicationException
    {
        var query = Try.of(() -> QueryFactory.create(queryString))
            .getOrElseThrow(e -> new WebApplicationException(400));

        Handler handler = HANDLERS.get(query.queryType());
        if (handler == null)
            throw new WebApplicationException(422);

        var lang = Optional.ofNullable(
                req.selectVariant(handler.accept()))
            .map(v -> v.getMediaType().toString())
            .map(handler.ctToLang())
            .orElseThrow(() -> new WebApplicationException(406));

        try (var qexec = QueryExecutionFactory.create(query, ds)) {
            return handler.handle().apply(qexec, lang);
        }
        catch (Exception e) {
            throw new WebApplicationException(e, 500);
        }
    }

    @GET
    public StreamingOutput sparqlGet (@QueryParam("query") String qs)
    {
        return sparql(qs);
    }

    @POST
    @Consumes("application/x-www-form-urlencoded")
    public StreamingOutput sparqlForm (@FormParam("query") String qs)
    {
        return sparql(qs);
    }
}
