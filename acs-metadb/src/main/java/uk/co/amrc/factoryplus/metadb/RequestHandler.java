/*
 * Factory+ metadata database
 * Request handler
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb;

/* Eventually these objects will need to be associated with a txn, and a
 * request, and contain the request UPN and the current txn Instant and
 * other per-request information. Possibly at this point this will
 * become a second object rather than a superclass. */
public abstract class RequestHandler
{
    protected RdfStore db;

    protected RequestHandler (RdfStore db)
    {
        this.db = db;
    }
}
