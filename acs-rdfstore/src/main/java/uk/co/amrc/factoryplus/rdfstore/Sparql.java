package uk.co.amrc.factoryplus.rdfstore;

import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.util.List;
import java.util.Optional;

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

    @POST
    @Consumes("application/sparql-update")
    public void update (String update)
    {
        UpdateAction.parseExecute(update, ds);
    }

    private abstract class Handler {
        protected Optional<Lang> lang;

        public Handler () {
            var vrn = req.selectVariant(acceptList());
            log.info("Selected Variant: {}", vrn);

            lang = Optional.ofNullable(vrn)
                .map(v -> v.getMediaType().toString())
                .map(WebContent::contentTypeToLangResultSet);
            log.info("Selected Lang: {}", lang);
        }

        public boolean acceptable () { return lang.isPresent(); }
        public abstract void handle (QueryExecution qe, OutputStream os);

        protected abstract List<Variant> acceptList ();
        protected abstract Lang contentTypeToLang (String ct);
    }
    private abstract class RsHandler extends Handler {
        protected List<Variant> acceptList () { return RS_TYPES; }

        protected Lang contentTypeToLang (String ct)
        {
            return WebContent.contentTypeToLangResultSet(ct);
        }
    }
    private class AskHandler extends RsHandler {
        public void handle (QueryExecution qe, OutputStream os)
        {
            boolean rs = qe.execAsk();
            ResultSetFormatter.output(os, rs, lang.get());
        }
    }
    private class SelectHandler extends RsHandler {
        public void handle (QueryExecution qe, OutputStream os)
        {
            ResultSet rs = qe.execSelect();
            ResultSetFormatter.output(os, rs, lang.get());
        }
    }
    public class ConstructHandler extends Handler {
        protected List<Variant> acceptList () { return RDF_TYPES; }

        protected Lang contentTypeToLang (String ct)
        {
            return RDFLanguages.contentTypeToLang(ct);
        }

        public void handle (QueryExecution qe, OutputStream os)
        {
            Model rs = qe.execConstruct();
            RDFDataMgr.write(os, rs, lang.get());
        }
    }

    @POST
    @Consumes("application/sparql-query")
    public byte[] sparql (String queryString) throws WebApplicationException
    {
        var query = Try.of(() -> QueryFactory.create(queryString))
            .getOrElseThrow(e -> new WebApplicationException(400));

        Handler handler;
        switch (query.queryType()) {
            case ASK:
                handler = this.new AskHandler();
                break;
            case CONSTRUCT:
                handler = this.new ConstructHandler();
                break;
            case SELECT:
                handler = this.new SelectHandler();
                break;
            default:
                throw new WebApplicationException(422);
        }

        if (!handler.acceptable())
            throw new WebApplicationException(406);

        final var os = new ByteArrayOutputStream();
        try (var qexec = QueryExecutionFactory.create(query, ds)) {
            handler.handle(qexec, os);
        }
        catch (Exception e) {
            throw new WebApplicationException(e, 500);
        }

        return os.toByteArray();
    }

    @GET
    public byte[] sparqlGet (@QueryParam("query") String qs)
    {
        return sparql(qs);
    }

    @POST
    @Consumes("application/x-www-form-urlencoded")
    public byte[] sparqlForm (@FormParam("query") String qs)
    {
        return sparql(qs);
    }
}
