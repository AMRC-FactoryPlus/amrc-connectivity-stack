/*
 * Factory+ RDF store
 * Interface to backend triplestore
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.time.Instant;
import java.util.function.Consumer;
import java.util.function.Function;
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

import io.vavr.collection.Iterator;

/* This class is not called Model because of the conflict with Jena's
 * Model class. */
public class RdfStore
{
    private static final Logger log = LoggerFactory.getLogger(RdfStore.class);

    private Model       direct;
    private InfModel    derived;
    private Dataset     dataset;

    private AppMapper   appMapper;

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

        appMapper = new AppMapper(this);
    }

    public Dataset dataset () { return dataset; }
    public Model direct () { return direct; }
    public InfModel derived () { return derived; }

    public AppMapper appMapper () { return appMapper; }

    public void executeRead (Runnable r) { dataset.executeRead(r); }
    public <T> T calculateRead (Supplier<T> s) { return dataset.calculateRead(s); }

    public void executeWrite (Runnable r) { dataset.executeWrite(r); }
    public <T> T calculateWrite (Supplier<T> s) { return dataset.calculateWrite(s); }

    public <T> T requestRead (Function<RequestHandler, T> cb)
    {
        return calculateRead(() -> cb.apply(new RequestHandler(this)));
    }
    public <T> T requestWrite (Function<RequestHandler, T> cb)
    {
        var req = new RequestHandler(this);
        var updater = req.appUpdater();

        T rv = calculateWrite(() -> {
            var rv2 = cb.apply(req);
            updater.update();
            return rv2;
        });

        updater.publish();
        return rv;
    }
    public void requestExecute (Consumer<RequestHandler> cb)
    {
        requestWrite(req -> { cb.accept(req); return 1; });
    }

    public ResultSet selectQuery (Query query, Object... substs)
    {
        var exec = QueryExecution.dataset(dataset)
            .query(query);
        Iterator.of(substs)
            .grouped(2)
            .forEach(sq -> exec.substitution((String)sq.get(0), (RDFNode)sq.get(1)));
        return exec.build().execSelect();
    }

    public Optional<QuerySolution> optionalQuery (Query query, Object... substs)
    {
        return Util.single(selectQuery(query, substs));
    }

    public QuerySolution singleQuery (Query query, Object... substs)
    {
        return Util.singleOrError(selectQuery(query, substs));
    }

    public void runUpdate (UpdateRequest update, Object... substs)
    {
        var exec = UpdateExecution.dataset(dataset)
            .update(update);
        Iterator.of(substs)
            .grouped(2)
            .forEach(sq -> exec.substitution((String)sq.get(0), (RDFNode)sq.get(1)));
        exec.execute();
    }

    /** Find a single resource within the direct graph. */
    public Optional<Resource> findResource (Property pred, RDFNode obj)
    {
        return Util.single(
            direct.listResourcesWithProperty(pred, obj));
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
        var binding = singleQuery(Q_findRank, "obj", obj);
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

        return createObject(klass, uuid);
    }

    /* TXN */
    public FPObject createObject (Resource klass, UUID uuid)
    {
        var obj = Vocab.uuidResource(uuid);
        derived.add(obj, Vocab.uuid, uuid.toString());
        derived.add(obj, RDF.type, klass);
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

}
