/*
 * Factory+ RDF store
 * Interface to backend triplestore
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb;

import java.time.Instant;
import java.util.function.Supplier;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import jakarta.json.*;
import jakarta.ws.rs.WebApplicationException;

import org.apache.jena.datatypes.xsd.XSDDatatype;
import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.tdb2.TDB2Factory;
import org.apache.jena.update.*;
import org.apache.jena.vocabulary.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.vavr.*;
import io.vavr.control.*;

/* This class is not called Model because of the conflict with Jena's
 * Model class. */
public class RdfStore
{
    private static final Logger log = LoggerFactory.getLogger(RdfStore.class);

    private Model       direct;
    private InfModel    derived;
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
    public InfModel derived () { return derived; }

    public void executeRead (Runnable r) { dataset.executeRead(r); }
    public void executeWrite (Runnable r) { dataset.executeWrite(r); }
    public <T> T calculateRead (Supplier<T> s) { return dataset.calculateRead(s); }
    public <T> T calculateWrite (Supplier<T> s) { return dataset.calculateWrite(s); }

    /** Find a single resource within the direct graph. */
    public Optional<Resource> findResource (Property pred, RDFNode obj)
    {
        var subjs = direct
            .listResourcesWithProperty(pred, obj)
            .toList();
        if (subjs.isEmpty())
            return Optional.empty();
        if (subjs.size() > 1)
            throw new Err.CorruptRDF(String.format(
                "More than one candidate with %s/%s", pred, obj));
        
        return Optional.of(subjs.get(0));
    }

    /* TXN */
    public Optional<FPObject> findObject (UUID uuid)
    {
        return findResource(Vocab.uuid, Vocab.uuidLiteral(uuid))
            .map(node -> new FPObject(node, uuid));
    }

    public FPObject findObjectOrError (UUID uuid)
    {
        return findObject(uuid)
            .orElseThrow(() -> new Err.NotFound(uuid.toString()));
    }

    public Resource findRankClass (int rank)
    {
        return findResource(Vocab.rank, direct.createTypedLiteral(rank))
            .orElseThrow(() -> new Err.CorruptRDF("Cannot find rank class"));
    }

    private static final Query Q_findRank = Vocab.query("""
        select ?rank
        where { ?obj rdf:type/<core/rank> ?rank }
    """);

    public int findRank (Resource obj)
    {
        var exec = QueryExecution.dataset(dataset)
            .query(Q_findRank)
            .substitution("obj", obj)
            .build();
        var rs = exec.execSelect();
        
        if (!rs.hasNext())
            throw new Err.CorruptRDF("Cannot find rank of object");
        var binding = rs.next();
        if (rs.hasNext())
            throw new Err.CorruptRDF("Duplicate ranks");

        return Util.decodeLiteral(binding.get("rank"), XSD.xint, Integer::parseInt);
    }

    /* TXN */
    public FPObject createObject (Resource klass)
    {
        UUID uuid;
        while (true) {
            uuid = UUID.randomUUID();
            var existing = findObject(uuid);
            if (existing.isEmpty())
                break;
        }

        var obj = derived.createResource();
        derived.add(obj, Vocab.uuid, uuid.toString());
        derived.add(obj, Vocab.primary, klass);

        var rank = findRank(obj);
        if (rank > 0) {
            var rk = findRankClass(rank - 1);
            derived.add(obj, RDFS.subClassOf, rk);
        }

        return new FPObject(obj, uuid);
    }

    /* TXN */
    public Resource createInstant ()
    {
        var inst = createObject(Vocab.Instant).node();
        var stamp = derived.createTypedLiteral(Instant.now(), XSDDatatype.XSDdateTime);
        derived.add(inst, Vocab.timestamp, stamp);
        return inst;
    }

    public ObjectStructure objectStructure ()
    {
        return ObjectStructure.create(this);
    }

    public ConfigEntry configEntry (UUID app, UUID obj)
    {
        return ConfigEntry.create(this, app, obj);
    }
}
