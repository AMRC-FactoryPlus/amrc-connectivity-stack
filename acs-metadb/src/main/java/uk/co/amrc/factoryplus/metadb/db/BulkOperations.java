/*
 * Factory+ metadata database
 * Bulk operations request handler
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;

import jakarta.json.*;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.update.*;
import org.apache.jena.vocabulary.*;

import io.vavr.collection.Iterator;
import io.vavr.control.Option;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.client.FPUuid;
import uk.co.amrc.factoryplus.service.*;

/* Some methods in this class check permissions; some do not. */

public class BulkOperations extends RequestHandler.Component
{
    private static final Logger log = LoggerFactory.getLogger(BulkOperations.class);

    private BulkOperations (RequestHandler req)
    {
        super(req);
    }

    public static BulkOperations create (RequestHandler req)
    {
        return new BulkOperations(req);
    }
}
