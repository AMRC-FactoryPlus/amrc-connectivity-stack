/*
 * Factory+ metadata database
 * Request handler
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import jakarta.ws.rs.core.SecurityContext;

import org.apache.jena.rdf.model.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.vavr.Lazy;

import uk.co.amrc.factoryplus.client.FPAuth;
import uk.co.amrc.factoryplus.service.*;

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

    private FPAuth.Checker checker;
    private UUID clientUUID;
    private Resource clientResource;

    public RequestHandler (RdfStore db, SecurityContext ctx)
    {
        this.db = db;
        this.now = Lazy.of(db::createInstant);
        this.upn = ctx.getUserPrincipal().getName();

        //log.info("Handling request for {}", upn);
    }

    public RdfStore db () { return db; }
    public Resource getInstant () { return now.get(); }
    public String upn () { return upn; }

    /* These will throw if we can't contact the Auth service. It's
     * important they throws on-thread as we need to abort the current
     * HTTP request. It's also important we fetch this before the txn
     * starts to avoid attempting external network access with a txn
     * open. */
    public RequestHandler fetchACL ()
    {
        checker = db().fplus().auth()
            .fetchChecker(upn)
            .blockingGet();
        return this;
    }
    public RequestHandler fetchClientUUID ()
    {
        log.info("Fetching client UUID");
        var auth = db().fplus().auth();
        if (auth.isRoot(upn)) {
            /* XXX This is specific to the ConfigDB ownership setup;
             * maybe instead of Unowned we should always have used the
             * root principal UUID? But in an ideal world that would not
             * be fixed but be per-installation. Maybe Unowned should be
             * generalised to a 'virtual Principal' representing 'users
             * who are acting as root'. In that case this special-casing
             * could be moved into FPAuth. */
            clientUUID = Vocab.U_Unowned;
        }
        else {
            clientUUID = db().fplus().auth()
                .resolveIdentity("kerberos", upn)
                .blockingGet()
                .getOrElseThrow(() -> new SvcErr.Upstream("I don't know who you are"));
        }
        return this;
    }

    /* These are not necessarily available. Calling them when they have
     * not been set up will throw a null pointer exception; this is
     * expected, it indicates an internal error. The framework should
     * catch these errors and return 500. */
    public void checkACL (UUID perm, UUID target)
    {
        log.info("Checking permission for {} / {}", perm, target);
        if (!checker.check(perm, target))
            throw new SvcErr.Forbidden();
    }
    public UUID clientUUID ()
    {
        return Objects.requireNonNull(clientUUID);
    }
    public Resource clientResource ()
    {
        if (clientResource == null) {
        }
        return clientResource;
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
    public BulkOperations bulkOperations ()
    {
        return BulkOperations.create(this);
    }
}
