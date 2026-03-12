/*
 * Factory+ RDF store
 * Exception indicating corruption of core data structures.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb;

import java.util.UUID;

public class Err extends Error
{
    public Err (String msg)
    {
        super(msg);
    }

    public static class CorruptRDF extends Err
    {
        private UUID uuid;

        public CorruptRDF (String msg, UUID uuid)
        {
            super(msg);
            this.uuid = uuid;
        }

        public UUID uuid () { return uuid; }
    }
    public static class Config extends CorruptRDF
    {
        private UUID app;

        public Config (String msg, UUID app, UUID obj)
        {
            super(msg, obj);
            this.app = app;
        }

        public UUID app () { return app; }
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
}
