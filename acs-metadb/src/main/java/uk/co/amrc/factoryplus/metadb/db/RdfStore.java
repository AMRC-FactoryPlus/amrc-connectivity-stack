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
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import jakarta.json.*;
import jakarta.ws.rs.core.SecurityContext;

import org.apache.jena.datatypes.xsd.XSDDatatype;
import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.tdb2.TDB2Factory;
import org.apache.jena.update.*;
import org.apache.jena.vocabulary.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.vavr.collection.Iterator;
import io.vavr.control.Option;

import uk.co.amrc.factoryplus.service.*;

/* This class is not called Model because of the conflict with Jena's
 * Model class. */
/* XXX I think this is two or possibly three classes: a component
 * locator, a Dataset wrapper, and a F+ object creator. */
public class RdfStore
{
    private static final Logger log = LoggerFactory.getLogger(RdfStore.class);

    private Model       direct;
    private InfModel    derived;
    private Dataset     dataset;

    private Dataflow        dataflow;
    private MetaDBNotify    metaNotify;
    private AppMapper       appMapper;
    private SchemaTracker   schemaTracker;

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

        dataflow        = new Dataflow(this);
        metaNotify      = new MetaDBNotify(this);
        appMapper       = new AppMapper(this);
        schemaTracker   = new SchemaTracker(this);
    }

    public Dataset dataset () { return dataset; }
    public Model direct () { return direct; }
    public InfModel derived () { return derived; }

    public Dataflow dataflow () { return dataflow; }
    public MetaDBNotify metaNotify () { return metaNotify; }
    public AppMapper appMapper () { return appMapper; }
    public SchemaTracker schemaTracker () { return schemaTracker; }

    public void start ()
    {
        dataflow.start();
        schemaTracker.start();
    }

    public void executeRead (Runnable r) { dataset.executeRead(r); }
    public <T> T calculateRead (Supplier<T> s) { return dataset.calculateRead(s); }

    public void executeWrite (Runnable r) { dataset.executeWrite(r); }
    public <T> T calculateWrite (Supplier<T> s) { return dataset.calculateWrite(s); }

    public <T> T requestRead (SecurityContext ctx, Function<RequestHandler, T> cb)
    {
        return calculateRead(() -> cb.apply(new RequestHandler(this, ctx)));
    }

    /* Jena ModelChangedListeners do not appear to respect inference
     * when reporting additions, but do when reporting removals. This is
     * surely a bug but one we have to work with for now. For
     * consistency we watch the direct model, and rely on the derived
     * model not making use of any RDFS except rdfs:subClassOf. In
     * particular:
     * - No use of rdfs:subPropertyOf.
     * - No use of rdfs:{domain,range} to infer rdf:type.
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
     * We could optimise the class structure handling by notifying the
     * rank of the changed class. With strict ranks it is not possible
     * for a change in one rank to propagate into other ranks. If we
     * introduced inference for powertypes this would change.
     */
    public <T> T requestWrite (SecurityContext ctx, Function<RequestHandler, T> cb)
    {
        var req = new RequestHandler(this, ctx);
        var listener = new ModelUpdate();
        T rv;

        try {
            dataset.begin(ReadWrite.WRITE);
            direct.register(listener);
            rv = cb.apply(req);
            /* This updates all structured entries by iteration over
             * the domains. This could be optimised by using the
             * change-notify information collected up to this point. */
            req.appUpdater().update();
            dataset.commit();
        }
        catch (Throwable e) {
            dataset.abort();
            throw e;
        }
        finally {
            direct.unregister(listener);
            dataset.end();
        }

        var update = listener.dataset(derived);
        /* It is important that all dataflow processing that queries the
         * update dataset happens syncronously. Otherwise it won't be in
         * this transaction. */
        update.executeRead(() -> dataflow.modelUpdate(update));

        return rv;
    }
    public void requestExecute (SecurityContext ctx, Consumer<RequestHandler> cb)
    {
        requestWrite(ctx, req -> { cb.accept(req); return 1; });
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

    public Option<QuerySolution> optionalQuery (Query query, Object... substs)
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
    public Option<Resource> findResource (Property pred, RDFNode obj)
    {
        return Util.single(
            direct.listResourcesWithProperty(pred, obj));
    }

    public void removeResource (Resource node)
    {
        derived.removeAll(node, null, null);
        derived.removeAll(null, null, node);

        /* We don't do this yet but we may in the future. */
        if (node.canAs(Property.class))
            derived.removeAll(null, node.as(Property.class), null);
    }

    public Option<FPObject> findObject (UUID uuid)
    {
        return findResource(Vocab.uuid, Vocab.uuidLiteral(uuid))
            .map(node -> new FPObject(node, uuid));
    }

    public FPObject findObjectOrError (UUID uuid)
    {
        return findObject(uuid)
            .getOrElseThrow(() -> new SvcErr.NotFound(uuid.toString()));
    }

    public Resource findRankClass (int rank)
    {
        return findResource(Vocab.rank, direct.createTypedLiteral(rank))
            .getOrElseThrow(() -> new RdfErr.CorruptRDF("Cannot find rank class"));
    }

    private static final Query Q_findRank = Vocab.query("""
        select ?rank
        where { ?obj rdf:type/<core/rank> ?rank }
    """);

    public int findRank (Resource obj)
    {
        var binding = singleQuery(Q_findRank, "obj", obj);
        return Util.decodeLiteral(binding.get("rank"), Integer.class);
    }

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

    public Resource createInstant ()
    {
        var inst = createObject(Vocab.Time.Instant).node();
        var stamp = derived.createTypedLiteral(Instant.now(), XSDDatatype.XSDdateTime);
        derived.add(inst, Vocab.Time.timestamp, stamp);
        return inst;
    }

}
