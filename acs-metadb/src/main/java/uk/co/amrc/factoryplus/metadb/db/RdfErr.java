/*
 * Factory+ RDF store
 * Exception indicating corruption of core data structures.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;

import jakarta.json.*;

import io.vavr.collection.*;

import org.apache.jena.rdf.model.*;

import uk.co.amrc.factoryplus.service.SvcErr;

public final class RdfErr
{
    public static class CorruptRDF extends SvcErr
    {
        public CorruptRDF (String msg)
        {
            super(msg);
        }
    }
    public static class Config extends CorruptRDF
    {
        private UUID app;
        private UUID obj;

        public Config (String msg, UUID app, UUID obj)
        {
            super(msg);
            this.app = app;
            this.obj = obj;
        }

        public UUID app () { return app; }
        public UUID obj () { return obj; }
    }
    public static class NotLiteral extends CorruptRDF
    {
        public NotLiteral (RDFNode n)
        {
            super("Expecting literal, not " + n.toString());
        }
    }
    public static class BadLiteral extends CorruptRDF
    {
        public BadLiteral (Literal l)
        {
            super("Cannot decode literal: " + l.toString());
        }
    }

    public static class BadConfig extends SvcErr.BadInput
    {
        private JsonValue config;
        public BadConfig (JsonValue val) {
            super("Invalid config entry");
            this.config = val;
        }
        protected void extendJson (JsonObjectBuilder obj) {
            obj.add("config", config);
        }
    }
    public static class UUIDNotFound extends SvcErr.NotFound
    {
        private UUID uuid;
        public UUIDNotFound (UUID uuid) {
            super("UUID not found");
            this.uuid = uuid;
        }
        public UUID uuid () { return uuid; }
        protected void extendJson (JsonObjectBuilder obj) {
            obj.add("uuid", uuid.toString());
        }
    }

    public static class Immutable extends SvcErr.Client
    {
        public Immutable () { super("Object is immutable"); }
        public int statusCode () { return 405; }
        public Map<String, String> buildHeaders ()
        {
            return HashMap.of("Allow", "GET, HEAD");
        }
    }

    public static class RankMismatch extends SvcErr.Conflict
    {
        public RankMismatch () { super("Rank mismatch"); }
    }
    public static class InUse extends SvcErr.Conflict
    {
        public InUse () { super("Object in use"); }
    }
    public static class InvalidObjs extends SvcErr.Conflict
    {
        private List<UUID> objects;
        public InvalidObjs (String msg, List<UUID> objects)
        {
            super(msg);
            this.objects = objects;
        }
        protected void extendJson (JsonObjectBuilder obj)
        {
            obj.add("objects", objects
                .map(UUID::toString)
                .foldLeft(Json.createArrayBuilder(), (a, v) -> a.add(v))
                .build());
        }
    }
    public static class SchemaConflict extends InvalidObjs
    {
        public SchemaConflict (List<UUID> conflicts)
        {
            super("Schema conflicts with existing objects", conflicts);
        }
    }
    public static class InvalidIris extends SvcErr.Conflict
    {
        private List<Resource> iris;
        public InvalidIris (String msg, List<Resource> iris)
        {
            super(msg);
            this.iris = iris;
        }
        protected void extendJson (JsonObjectBuilder obj)
        {
            obj.add("iris", iris
                .map(Resource::toString)
                .foldLeft(Json.createArrayBuilder(), (a, v) -> a.add(v))
                .build());
        }
    }
    public static class InvalidRels extends SvcErr.Conflict
    {
        private Map<UUID, UUID> relations;
        public InvalidRels (String msg, Map<UUID, UUID> relations)
        {
            super(msg);
            this.relations = relations;
        }
        protected void extendJson (JsonObjectBuilder obj)
        {
            obj.add("relations", 
                Json.createObjectBuilder(relations
                    .mapKeys(UUID::toString)
                    .mapValues(v -> (Object)v.toString())
                    .toJavaMap())
                .build());
        }
    }
}
