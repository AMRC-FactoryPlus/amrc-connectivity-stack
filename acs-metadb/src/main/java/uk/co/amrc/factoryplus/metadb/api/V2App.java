/*
 * Factory+ RDF store
 * App endpoints
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.api;

import java.util.Date;
import java.util.UUID;
import java.util.function.Supplier;

import jakarta.inject.*;
import jakarta.json.*;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import org.apache.jena.rdf.model.*;
import org.apache.jena.vocabulary.*;

import io.vavr.Lazy;
import io.vavr.collection.*;
import io.vavr.control.*;

import uk.co.amrc.factoryplus.metadb.db.*;

@Path("v2/app/{app}")
@Consumes("application/json")
public class V2App {
    private static final Logger log = LoggerFactory.getLogger(V2App.class);

    @Inject private RdfStore db;
    @Inject private SecurityContext auth;

    /* Because we are pulling from dataflow we do not need our own txns.
     * Dataflow will open a txn if it needs to do an initial fetch and
     * doesn't have cached results already. This means we don't want to
     * use requestRead and need to build our own RequestHandler. */
    private Lazy<RequestHandler> req = Lazy.of(() ->
        new RequestHandler(db, auth)
            .fetchACL());

    @PathParam("app")       private UUID app;

    private void checkACL (UUID perm, UUID targ)
    {
        req.get().checkACL(perm, targ);
    }

    private JsonValue uuidSet (Set<UUID> uuids)
    {
        var strs = uuids.map(UUID::toString)
            .toJavaSet();
        return Json.createArrayBuilder(strs)
            .build();
    }

    private Map<UUID, ConfigEntry.Value> appValues ()
    {
        return db.dataflow()
            .appValues(app)
            .blockingFirst();
    }

    @GET @Path("object")
    public JsonValue list ()
    {
        checkACL(Vocab.Perm.ReadApp, app);
        var objs = appValues().keySet();
        return uuidSet(objs);
    }

    private Set<UUID> findAll (JsonValue config)
    {
        return appValues()
            .filterValues(e -> e.value().equals(config))
            .keySet();
    }

    @POST @Path("find")
    public JsonValue find (JsonValue config)
    {
        checkACL(Vocab.Perm.ReadApp, app);
        return uuidSet(findAll(config));
    }

    @POST @Path("class/{class}/find")
    public JsonValue findInClass (@PathParam("class") UUID klass, JsonValue config)
    {
        checkACL(Vocab.Perm.ReadApp, app);
        var rel = Relation.of("member").bind(klass, true, false);
        checkACL(rel.perm(), klass);

        var objs = findAll(config);
        var mems = db.dataflow()
            .relation(rel)
            .blockingFirst();
        return uuidSet(objs.intersect(mems));
    }
}
