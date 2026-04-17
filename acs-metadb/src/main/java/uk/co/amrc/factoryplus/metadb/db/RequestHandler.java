/*
 * Factory+ metadata database
 * Request handler
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import org.apache.jena.rdf.model.*;

import io.vavr.Lazy;

/* Eventually these objects will need to be associated with a txn, and a
 * request, and contain the request UPN and the current txn Instant and
 * other per-request information. Possibly at this point this will
 * become a second object rather than a superclass. */
public class RequestHandler
{
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

    public RequestHandler (RdfStore db)
    {
        this.db = db;
        this.now = Lazy.of(db::createInstant);
    }

    public RdfStore db () { return db; }
    public Resource getInstant () { return now.get(); }

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
