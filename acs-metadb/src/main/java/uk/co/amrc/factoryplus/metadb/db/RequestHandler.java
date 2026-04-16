/*
 * Factory+ metadata database
 * Request handler
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import jakarta.ws.rs.core.SecurityContext;

import org.apache.jena.rdf.model.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.vavr.Lazy;

import uk.co.amrc.factoryplus.service.*;

/* Eventually these objects will need to be associated with a txn, and a
 * request, and contain the request UPN and the current txn Instant and
 * other per-request information. Possibly at this point this will
 * become a second object rather than a superclass. */
public class RequestHandler
{
    private static final Logger log = LoggerFactory.getLogger(RequestHandler.class);

    public static abstract class Component
    {
        private RequestHandler req;

        protected Component (RequestHandler req)
        {
            this.req = req;
        }

        protected RequestHandler request () { return req; }
        protected RdfStore db () { return req.db(); }
    }

    private RdfStore db;
    private Lazy<Resource> now;
    private String upn;

    public RequestHandler (RdfStore db, SecurityContext ctx)
    {
        this.db = db;
        this.now = Lazy.of(db::createInstant);
        this.upn = ctx.getUserPrincipal().getName();

        log.info("Handling request for {}", upn);
    }

    public RdfStore db () { return db; }
    public Resource getInstant () { return now.get(); }
    public String upn () { return upn; }

    /* This must throw on-thread as we will be within a txn. */
    public void checkACL (UUID perm, UUID target)
    {
        log.info("Checking permission for {} / {}", perm, target);
        var ok = db().fplus().auth()
            .checkACL(upn, perm, target)
            .blockingGet();
        if (!ok)
            throw new SvcErr.Forbidden();
    }

    public ObjectStructure objectStructure ()
    {
        return ObjectStructure.create(this);
    }
    public ConfigEntry configEntry (UUID app, UUID obj)
    {
        return ConfigEntry.create(this, app, obj);
    }
    public ConfigEntry configEntry (Resource app, Resource obj)
    {
        return new ConfigEntry(this, app, obj);
    }
    public AppUpdater appUpdater ()
    {
        return new AppUpdater(this);
    }
}
