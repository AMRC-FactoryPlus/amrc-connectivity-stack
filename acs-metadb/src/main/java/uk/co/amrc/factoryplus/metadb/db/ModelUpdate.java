/*
 * Factory+ metadata database
 * Change-notify model listener
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.HashSet;
import java.util.Set;

import org.apache.jena.query.*;
import org.apache.jena.rdf.listeners.StatementListener;
import org.apache.jena.rdf.model.*;
import org.apache.jena.rdf.model.impl.StmtIteratorImpl;
import org.apache.jena.vocabulary.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ModelUpdate extends StatementListener
{
    /* Currently (with TDB2) it appears that Jena will only allow one
     * write transaction to be active at a time. A subsequent parallel
     * txn will block on the first write until the first commits or
     * aborts. We rely on this to track which changes belong to which
     * txn, and whether they committed or not. If this changes this
     * class will need to track thread IDs and rely on the
     * one-txn-per-thread restriction instead: changes made on a
     * different thread from the one which created this NotifyListener
     * are not in our txn and not our business. */

    private static final Logger log = LoggerFactory.getLogger(ModelUpdate.class);

    private Set<Statement> added    = new HashSet<>();
    private Set<Statement> removed  = new HashSet<>();

    public Dataset dataset (Model derived)
    {
        var ds = DatasetFactory.create(derived);
        ds.addNamedModel(Vocab.G_derived, derived);
        ds.addNamedModel(Vocab.G_added, toModel(added));
        ds.addNamedModel(Vocab.G_removed, toModel(removed));
        return ds;
    }

    private static Model toModel (Set<Statement> s)
    {
        return new StmtIteratorImpl(s.iterator())
            .toModel();
    }

    public void addedStatement (Statement stmt)
    {
        //log.info("ADDED\n  {}", stmt);
        added.add(stmt);
        removed.remove(stmt);
    }
    
    public void removedStatement (Statement stmt)
    {
        //log.info("REMOVED\n  {}", stmt);
        removed.add(stmt);
        added.remove(stmt);
    }
}

