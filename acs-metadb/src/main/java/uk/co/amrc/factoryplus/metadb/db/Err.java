/*
 * Factory+ RDF store
 * Exception indicating corruption of core data structures.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.Map;
import java.util.UUID;

import jakarta.json.*;

import org.apache.jena.rdf.model.*;

public class Err extends Error
{
    public Err (String msg)
    {
        super(msg);
    }

    public static class CorruptRDF extends Err
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

    public static abstract class ClientError extends Err
    {
        public ClientError (String msg)
        {
            super(msg);
        }

        public abstract int statusCode ();

        public JsonValue buildJson ()
        {
            var obj = Json.createObjectBuilder()
                .add("message", getMessage());
            extendJson(obj);
            return obj.build();
        }
        protected void extendJson (JsonObjectBuilder obj) { }

        public Map<String, String> buildHeaders ()
        {
            return Map.of();
        }
    }
    public static class Forbidden extends ClientError
    {
        public Forbidden ()
        {
            super("Access denied");
        }

        public int statusCode () { return 403; }
    }
    public static class NotFound extends ClientError
    {
        public NotFound (String res)
        {
            super("Resource not found: " + res);
        }

        public int statusCode () { return 404; }
    }
    public static class InvalidName extends ClientError
    {
        public InvalidName (String name)
        {
            super("Invalid resource name: " + name);
        }

        public int statusCode () { return 410; }
    }
    public static class BadJson extends ClientError
    {
        public BadJson (JsonValue val)
        {
            super("Unexpected JSON value: " + val.toString());
        }

        public int statusCode () { return 422; }
    }
    public static class BadConfig extends ClientError
    {
        private Resource app;
        private JsonValue config;

        public BadConfig (Resource app, JsonValue val)
        {
            super("Invalid config entry for " + app);
            this.app = app;
            this.config = val;
        }

        public int statusCode () { return 422; }
        protected void extendJson (JsonObjectBuilder obj)
        {
            obj.add("appIRI", app.toString())
                .add("config", config);
        }
    }
    public static class RankMismatch extends ClientError
    {
        public RankMismatch () { super("Rank mismatch"); }
        public int statusCode () { return 409; }
    }
    public static class NotMember extends ClientError
    {
        public NotMember () { super("Not a member of a required class"); }
        public int statusCode () { return 409; }
    }
    public static class InUse extends ClientError
    {
        public InUse () { super("Object in use"); }
        public int statusCode () { return 409; }
    }
    public static class Immutable extends ClientError
    {
        public Immutable () { super("Object is immutable"); }
        public int statusCode () { return 405; }
        public Map<String, String> buildHeaders ()
        {
            return Map.of("Allow", "GET, HEAD");
        }
    }
    public static class InvalidConfig extends BadConfig
    {
        public InvalidConfig (Resource app, JsonValue val) { super(app, val); }
        public int statusCode () { return 405; }
        public Map<String, String> buildHeaders ()
        {
            return Map.of("Allow", "PUT, DELETE");
        }
    }
}
