/*
 * Factory+ RDF store
 * Interface to backend triplestore
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb;

import java.util.function.Supplier;
import java.util.Optional;
import java.util.UUID;

import jakarta.ws.rs.WebApplicationException;

import org.apache.jena.query.Dataset;
import org.apache.jena.query.DatasetFactory;
import org.apache.jena.rdf.model.*;
import org.apache.jena.tdb2.TDB2Factory;

/* This class is not called Model because of the conflict with Jena's
 * Model class. */
class RdfStore
{
    private Model       direct;
    private Model       derived;
    private Dataset     dataset;

    /* We build a Dataset out of these named graphs:
     * - G_direct: this is G_direct from the TDB.
     * - G_derived: this is RDFS(G_direct).
     * - default: this is equal to G_derived.
     */
    public RdfStore (String data)
    {
        var tdb     = TDB2Factory.connectDataset(data);
        direct      = tdb.getNamedModel(Vocab.G_direct);
        derived     = ModelFactory.createRDFSModel(direct);
        dataset     = DatasetFactory.create(derived);

        dataset.addNamedModel(Vocab.G_direct, direct);
        dataset.addNamedModel(Vocab.G_derived, derived);
    }

    public Dataset dataset () { return dataset; }
    public Model direct () { return direct; }
    public Model derived () { return derived; }

    public void executeRead (Runnable r) { dataset.executeRead(r); }
    public void executeWrite (Runnable r) { dataset.executeWrite(r); }
    public <T> T calculateRead (Supplier<T> s) { return dataset.calculateRead(s); }
    public <T> T calculateWrite (Supplier<T> s) { return dataset.calculateWrite(s); }

    /* Must be called within a txn */
    public Optional<Resource> findObject (UUID uuid)
    {
        /* We always resolve UUIDs within the direct graph. */
        var klasses = direct
            .listResourcesWithProperty(Vocab.uuid, uuid.toString())
            .toList();
        if (klasses.isEmpty())
            return Optional.empty();
        if (klasses.size() > 1)
            throw new CorruptionException("More than one candidate", uuid);
        
        var klass = klasses.get(0);
        if (!klass.isURIResource())
            throw new CorruptionException("UUID does not name a URI", uuid);

        return Optional.of(klass);
    }

    /* I don't entirely like this being here, it's a layer violation for
     * this class to know about HTTP errors. But it's too annoying
     * otherwise, and we are a REST webservice implementation. */
    public Resource findObjectOr404 (UUID uuid)
    {
        return findObject(uuid)
            .orElseThrow(() -> new WebApplicationException(404));
    }
}
