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

    public static class BadConfig extends SvcErr.Client
    {
        private JsonValue config;

        public BadConfig (JsonValue val)
        {
            super("Invalid config entry");
            this.config = val;
        }

        public int statusCode () { return 422; }
        protected void extendJson (JsonObjectBuilder obj)
        {
            obj.add("config", config);
        }
    }
    public static class RankMismatch extends SvcErr.Client
    {
        public RankMismatch () { super("Rank mismatch"); }
        public int statusCode () { return 409; }
    }
    public static class NotMember extends SvcErr.Client
    {
        public NotMember () { super("Not a member of a required class"); }
        public int statusCode () { return 409; }
    }
    public static class InUse extends SvcErr.Client
    {
        public InUse () { super("Object in use"); }
        public int statusCode () { return 409; }
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

    public static class InvalidObjs extends SvcErr.Client
    {
        private List<UUID> objects;
        public InvalidObjs (String msg, List<UUID> objects)
        {
            super(msg);
            this.objects = objects;
        }
        public int statusCode () { return 409; }
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

    public static class InvalidIris extends SvcErr.Client
    {
        private List<Resource> iris;
        public InvalidIris (String msg, List<Resource> iris)
        {
            super(msg);
            this.iris = iris;
        }
        public int statusCode () { return 409; }
        protected void extendJson (JsonObjectBuilder obj)
        {
            obj.add("iris", iris
                .map(Resource::toString)
                .foldLeft(Json.createArrayBuilder(), (a, v) -> a.add(v))
                .build());
        }
    }

    public static class InvalidRels extends SvcErr.Client
    {
        private Map<UUID, UUID> relations;
        public InvalidRels (String msg, Map<UUID, UUID> relations)
        {
            super(msg);
            this.relations = relations;
        }
        public int statusCode () { return 409; }
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
