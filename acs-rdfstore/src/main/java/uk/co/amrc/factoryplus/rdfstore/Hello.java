package uk.co.amrc.factoryplus.rdfstore;

import jakarta.inject.*;
import jakarta.ws.rs.*;

import org.apache.jena.rdf.model.*;
import org.apache.jena.query.*;
import org.apache.jena.update.*;

@Path("/hello")
public class Hello {
    @Inject
    private Dataset ds;

    @GET
    @Produces("text/plain")
    public String hello ()
    {
        return "Hello world: this " + this.toString()
            + " ds: " + System.identityHashCode(ds);
    }

    @POST @Path("sparql")
    @Consumes("application/sparql-update")
    public void update (String update)
    {
        UpdateAction.parseExecute(update, ds);
    }


    @POST @Path("sparql")
    @Consumes("application/sparql-query")
    public String sparql (String queryString)
    {
        var query = QueryFactory.create(queryString);

        try (var qexec = QueryExecutionFactory.create(query, ds)) {
            ResultSet rs = qexec.execSelect();
            return ResultSetFormatter.asText(rs);
        }
    }
}
