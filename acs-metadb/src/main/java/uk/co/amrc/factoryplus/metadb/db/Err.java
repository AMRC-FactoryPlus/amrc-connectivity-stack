/*
 * Factory+ RDF store
 * Exception indicating corruption of core data structures.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import java.util.UUID;

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

    public static abstract class ClientError extends Err
    {
        public ClientError (String msg)
        {
            super(msg);
        }

        public abstract int statusCode ();
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
    public static class RankMismatch extends ClientError
    {
        public RankMismatch ()
        {
            super("Rank mismatch");
        }

        public int statusCode () { return 409; }
    }
    public static class InUse extends ClientError
    {
        public InUse ()
        {
            super("Object in use");
        }

        public int statusCode () { return 409; }
    }
    public static class Immutable extends ClientError
    {
        public Immutable ()
        {
            super("Object is immutable");
        }

        public int statusCode () { return 405; }
    }
}
