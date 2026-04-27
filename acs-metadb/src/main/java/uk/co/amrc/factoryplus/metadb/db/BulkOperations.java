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

import io.vavr.collection.*;
import io.vavr.control.Option;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import uk.co.amrc.factoryplus.client.FPUuid;
import uk.co.amrc.factoryplus.service.*;

/* Some methods in this class check permissions; some do not. */

public class BulkOperations extends RequestHandler.Component
{
    private static final Logger log = LoggerFactory.getLogger(BulkOperations.class);

    record ObjSpec (
        UUID uuid,
        Resource iri,
        UUID primary,
        Option<String> name,
        Option<List<UUID>> memberOf,
        Option<List<UUID>> subclassOf,
        Option<UUID> powersetOf,
        Option<List<UUID>> enumMembers)
    {
        private static String jsonString (JsonValue v)
        {
            return ((JsonString)v).getString();
        }

        private static Option<List<UUID>> maybeUuidList (JsonObject spec, String key)
        {
            return Option.of(spec.get(key))
                .map(v -> Iterator.ofAll((JsonArray)v)
                    .map(ObjSpec::jsonString)
                    .map(Decoders::parseUUIDOrError)
                    .toList());
        }

        public static ObjSpec ofJson (String pri, String obj, JsonValue jval)
        {
            var uuid = Decoders.parseUUIDOrError(obj);
            var primary = Decoders.parseUUIDOrError(pri);
            var spec = (JsonObject)jval;

            var iri = Option.of(spec.get("iri"))
                .map(ObjSpec::jsonString)
                .map(Vocab::res)
                .getOrElse(() -> Vocab.uuidResource(uuid));
            var name = Option.of(spec.get("name"))
                .map(ObjSpec::jsonString);

            var memberOf = maybeUuidList(spec, "memberOf");
            var subclassOf =  maybeUuidList(spec, "subclassOf");
            var enumMembers = maybeUuidList(spec, "enum");

            var powersetOf = Option.of(spec.get("powersetOf"))
                .map(ObjSpec::jsonString)
                .map(Decoders::parseUUIDOrError);

            return new ObjSpec(uuid, iri, primary, name,
                memberOf, subclassOf, powersetOf, enumMembers);
        }
    }

    private BulkOperations (RequestHandler req)
    {
        super(req);
    }

    public static BulkOperations create (RequestHandler req)
    {
        return new BulkOperations(req);
    }

    private static Iterator<java.util.Map.Entry<String, JsonValue>>
        jsonEntries (JsonValue obj)
    {
        return Iterator.ofAll(
            ((JsonObject)obj).entrySet());
    }

    public void loadDump (JsonValue jval)
    {
        if (!db().schemaTracker().validateDump(jval))
            throw new SvcErr.BadInput("Invalid dump");
        log.info("Dump validated");

        var dump = (JsonObject)jval;
        Option.of(dump.get("objects"))
            .map(objs -> jsonEntries(objs)
                .flatMap(e1 -> jsonEntries(e1.getValue())
                    .map(e2 -> ObjSpec.ofJson(
                        e1.getKey(), e2.getKey(), e2.getValue())))
                .toList())
            .peek(this::loadObjects);
    }

    private void loadObjects (List<ObjSpec> objs)
    {
        log.info("Decoded obj specs: {}", objs);
    }
}
