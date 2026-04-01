/*
 * Factory+ metadata database
 * Change-notify model listener
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.HashSet;
import java.util.Set;

import org.apache.jena.rdf.listeners.StatementListener;
import org.apache.jena.rdf.model.*;
import org.apache.jena.vocabulary.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

class NotifyListener extends StatementListener
{
    /* Currently (with TDB2) it appears that Jena will only allow one
     * write transaction to be active at a time. A subsequent parallel
     * txn will block on the first write until the first commits or
     * aborts. We rely on this to track which changes belong to which
     * txn, and whether they committed or not. If this changes this
     * class will need to track thread IDs and rely on the
     * one-txn-per-thread restriction instead. */

    /* Jena ModelChangedListeners do not appear to respect inference
     * when reporting additions, but do when reporting removals. This is
     * surely a bug but one we have to work with for now. For
     * consistency we watch the direct model, and rely on the derived
     * model not making use of any RDFS except rdfs:subClassOf. In
     * particular:
     * - No use of rdfs:subPropertyOf.
     * - No use of rdfs:{domain,range} to infer rdf:type.
     *
     * We can optimise the class structure handling by notifying the
     * rank of the changed class. With strict ranks it is not possible
     * for a change in one rank to propagate into other ranks. If we
     * introduced inference for powertypes this would change.
     *
     * Subproperties could probably be handled by maintaining a cache of
     * the subproperty tree, and firing derived statements by hand. This
     * might be difficult when removing statements as we won't know
     * whether the derived statement is still present via another route.
     * As long as our interface is 'there may have been a change in this
     * property' this won't matter. Subproperties of rdf:type/
     * rdfs:subClassOf are likely to be the most important case, and
     * could perhaps be handled specially.
     * 
     * Handling derived config entries will be more difficult, even with
     * inference restricted to the class structure. Probably it will be
     * necessary to be rather crude and maintain a list of 'these
     * predicates might affect this Application' and check all entries
     * when any change. Restricting the domain of the Application may be
     * important here to avoid needing to check every F+ object.
     */

    private record Config (Resource app, Resource obj) {}

    private static final Logger log = LoggerFactory.getLogger(NotifyListener.class);

    private boolean done = false;
    private Set<Property> changed = new HashSet<>();

    private void checkDone ()
    {
        if (done)
            throw new IllegalStateException("Listener is complete");
    }

    public void commit ()
    {
        checkDone();
        done = true;
    }
    public void abort ()
    {
        checkDone();
        changed = Set.of();
        done = true;
    }
    public void end ()
    {
        if (!done)
            throw new IllegalStateException("Listener is not complete");
        log.info("CHANGED:");
        for (var p: changed)
            log.info("  {}", p);
    }

    private void changed (Statement stmt)
    {
        checkDone();
        changed.add(stmt.getPredicate());
    }

    public void addedStatement (Statement stmt)
    {
        log.info("ADDED\n  {}", stmt);
        changed(stmt);
    }
    
    public void removedStatement (Statement stmt)
    {
        log.info("REMOVED\n  {}", stmt);
        changed(stmt);
    }
}

