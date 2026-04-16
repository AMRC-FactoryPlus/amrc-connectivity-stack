/*
 * Factory+ RDF store
 * Exception indicating corruption of core data structures.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.Map;
import java.util.UUID;

import jakarta.json.*;

import io.vavr.collection.Set;

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
            return Map.of("Allow", "GET, HEAD");
        }
    }
    public static class SchemaConflict extends SvcErr.Client
    {
        private Set<UUID> conflicts;
        public SchemaConflict (Set<UUID> conflicts)
        {
            super("Schema conflicts with existing objects");
            this.conflicts = conflicts;
        }
        public int statusCode () { return 409; }
        protected void extendJson (JsonObjectBuilder obj)
        {
            obj.add("conflicts", conflicts
                .map(UUID::toString)
                .foldLeft(Json.createArrayBuilder(), (a, v) -> a.add(v))
                .build());
        }
    }
}
