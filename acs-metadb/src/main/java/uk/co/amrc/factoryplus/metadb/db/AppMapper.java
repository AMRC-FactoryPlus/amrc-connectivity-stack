/*
 * Factory+ metadata database
 * Structured application mapper
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

import jakarta.json.*;

import org.apache.jena.query.*;
import org.apache.jena.rdf.model.*;
import org.apache.jena.update.*;
import org.apache.jena.vocabulary.*;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import io.vavr.control.Try;

public class AppMapper {
    private static final Logger log = LoggerFactory.getLogger(AppMapper.class);

    /* Specific updaters for individual Apps. These should be replaced
     * with queries generated from schema entries. */

    private static final Query Q_objectRegistration = Vocab.query("""
        select ?uuid ?rank ?class ?owner ?strict ?deleted
        where {
            ?obj <core/uuid> ?uuid.
            optional {
                ?obj rdf:type/<core/rank> ?rank;
                    <core/primary>/<core/uuid> ?class.
            }

            optional { ?obj <core/owner>/<core/uuid> ?1. }
            bind(coalesce(?1, "091e796a-65c0-4080-adff-c3ce01a65b2e") as ?owner)

            optional { ?obj <core/deleted> ?2. }
            bind(coalesce(?2, false) as ?deleted)

            bind(true as ?strict)
        }
    """);

    private static final Query Q_generalInfo = Vocab.query("""
        select ?name
        where {
            ?obj <core/name> ?name.
        }
    """);
    private static final UpdateRequest D_generalInfo = Vocab.update("""
        delete where { ?obj <core/name> ?1. };
    """);
    private static final UpdateRequest U_generalInfo = Vocab.update("""
        insert { ?obj <core/name> ?name. } where {};
    """);

    private static final Query Q_sparkplugAddress = Vocab.query("""
        select ?group_id ?node_id ?device_id
        where {
            ?obj <sparkplug/groupId> ?group_id.
            optional { ?obj <sparkplug/nodeId> ?node_id. }
            optional { ?obj <sparkplug/deviceId> ?device_id. }
        }
    """);
    private static final UpdateRequest D_sparkplugAddress = Vocab.update("""
        delete where { ?obj <sparkplug/groupId> ?1. };
        delete where { ?obj <sparkplug/nodeId> ?2. };
        delete where { ?obj <sparkplug/deviceId> ?3. };
    """);
    private static final UpdateRequest U_sparkplugAddress = Vocab.update("""
        insert {
            ?obj <sparkplug/groupId> ?group_id;
                <sparkplug/nodeId> ?node_id;
                <sparkplug/deviceId> ?device_id.
        } where {};
    """);

    /* We have to bypass Jena's RDFDatatype system here and provide our
     * own mappings. We cannot map arbitrary objects to JSON, and the
     * JSON creation functions will not accept Object. */
    private static final Map<Resource, 
            Function<String, Optional<JsonValue>>> toJson = Map.of(
        XSD.xstring,    s -> Optional.of(Json.createValue(s)),
        XSD.xint,       s -> Try.of(() -> Integer.parseInt(s))
                                .toJavaOptional()
                                .map(Json::createValue),
        XSD.xboolean,   s -> s.equals("true") ? Optional.of(JsonValue.TRUE)
                            : s.equals("false") ? Optional.of(JsonValue.FALSE)
                            : Optional.empty(),
        RDF.JSON,       Util::readJson);

    private RdfStore db;

    private Map<Resource, Query> generators = Map.of(
        Vocab.Registration,     Q_objectRegistration,
        Vocab.Info,             Q_generalInfo,
        Vocab.SparkplugAddr,    Q_sparkplugAddress);
    private Map<Resource, UpdateRequest> deleters = Map.of(
        Vocab.Info,             D_generalInfo,
        Vocab.SparkplugAddr,    D_sparkplugAddress);
    private Map<Resource, UpdateRequest> updaters = Map.of(
        Vocab.Info,             U_generalInfo,
        Vocab.SparkplugAddr,    U_sparkplugAddress);

    public AppMapper (RdfStore db)
    {
        this.db = db;
    }

    public Optional<JsonValue> generateConfig (Resource app, Resource obj)
    {
        return Optional.ofNullable(generators.get(app))
            .flatMap(q -> db.optionalQuery(q, "obj", obj))
            .map(AppMapper::solutionToJson);
    }

    public void deleteConfig (Resource app, Resource obj)
    {
        if (app.equals(Vocab.Registration))
            throw new Err.Immutable();

        Optional.ofNullable(deleters.get(app))
            .ifPresent(d -> db.runUpdate(d, "obj", obj));
    }

    public void updateConfig (Resource app, Resource obj, JsonValue config)
    {
        /* XXX Reg can be updated but needs special handling */
        if (app.equals(Vocab.Registration)) {
            updateRegistration(obj, (JsonObject)config);
            return;
        }

        var sol = jsonToSolution(config);

        deleteConfig(app, obj);
        Optional.ofNullable(updaters.get(app))
            .ifPresent(u -> UpdateExecution.dataset(db.dataset())
                .update(u)
                .substitution(sol)
                .substitution("obj", obj)
                .execute());
    }

    /* XXX This assumes JSON schema validation has been performed.
     * Currently this is not implemented nor is a schema installed for
     * the Registration app. */
    private void updateRegistration (Resource obj, JsonObject spec)
    {
        if (!spec.getBoolean("strict")) {
            log.info("Objects must be strict");
            throw new Err.BadJson(spec.get("strict"));
        }
        if (!spec.getString("owner").equals(Vocab.U_Unowned.toString())) {
            log.info("Owners not implemented yet");
            throw new Err.Forbidden();
        }

        var rank = db.findRank(obj);
        if (spec.getInt("rank") != rank) {
            log.info("Rank changes can only be made via dumps");
            throw new Err.RankMismatch();
        }

        var model = db.derived();
        var uuid = Util.single(model.listObjectsOfProperty(obj, Vocab.uuid))
            .map(AppMapper::literalToJson)
            .orElseThrow(() -> new Err.CorruptRDF("Cannot find object UUID"));
        if (!spec.get("uuid").equals(uuid)) {
            log.info("UUIDs cannot be changed: {} vs {}", uuid, spec.get("uuid"));
            throw new Err.BadJson(spec.get("uuid"));
        }

        var klass = Vocab.parseUUID(spec.getString("class"))
            .flatMap(db::findObject)
            .map(FPObject::node)
            .orElseThrow(() -> {
                log.info("Cannot find new primary class");
                return new Err.BadJson(spec.get("class"));
            });
        /* This is a change from the JS implementation; here we require
         * the object to already be a member of the new primary class.
         * The ConfigDB will create a new direct membership if needed,
         * but will not remove it again if the primary class changes.
         * This is inconsistent and so has been changed. */
        if (!model.contains(obj, RDF.type, klass)) {
            log.info("Object not a member of new primary class");
            throw new Err.NotMember();
        }
        model.removeAll(obj, Vocab.primary, null);
        model.add(obj, Vocab.primary, klass);

        model.removeAll(obj, Vocab.deleted, null);
        model.addLiteral(obj, Vocab.deleted, spec.getBoolean("deleted"));
    }

    /* Currently this does dynamic decoding based on what was returned
     * from the RDF. Once we have query generation we should be able to
     * use the <core/to> properties to know what we are expecting. */
    private static JsonValue literalToJson (RDFNode node)
    {
        /* This should probably be selected based on optional/nullable
         * properties in the schema. */
        if (node == null) return JsonValue.NULL;

        if (!node.isLiteral())
            throw new Err.NotLiteral(node);
        
        var lit = node.asLiteral();
        var typ = ResourceFactory.createResource(lit.getDatatypeURI());

        return Optional.ofNullable(toJson.get(typ))
            .flatMap(d -> d.apply(lit.getLexicalForm()))
            .orElseThrow(() -> new Err.BadLiteral(lit));
    }

    private static JsonValue solutionToJson (QuerySolution rs)
    {
        var jobj = Json.createObjectBuilder();
        rs.varNames().forEachRemaining(n ->
            jobj.add(n, literalToJson(rs.get(n))));

        return jobj.build();
    }

    /* XXX This can only convert strings for now. In general we will
     * need expected type information as RDF has a richer type system
     * than JSON. */
    private static Literal jsonToLiteral (JsonValue val)
    {
        if (!(val instanceof JsonString))
            throw new Err.BadJson(val);

        return ResourceFactory.createPlainLiteral(
            ((JsonString)val).getString());
    }

    /* This can only decode flat objects for now */
    private static QuerySolution jsonToSolution (JsonValue val)
    {
        if (!(val instanceof JsonObject))
            throw new Err.BadJson(val);

        var qsol = new QuerySolutionMap();
        ((JsonObject)val).forEach(
            (k, v) -> qsol.add(k, jsonToLiteral(v)));

        return qsol;
    }
}
