/*
 * Factory+ RDF store
 * Exception indicating corruption of core data structures.
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.rdfstore;

import java.util.UUID;

class CorruptionException extends RuntimeException
{
    private String uri;
    private UUID uuid;

    public CorruptionException (String msg, String uri, UUID uuid)
    {
        super(msg);
        this.uri = uri;
        this.uuid = uuid;
    }

    public CorruptionException (String msg, String uri)
    {
        this(msg, uri, null);
    }

    public CorruptionException (String msg, UUID uuid)
    {
        this(msg, null, uuid);
    }

    public CorruptionException (String msg)
    {
        this(msg, null, null);
    }

    public CorruptionException ()
    {
        this("Core RDF data is corrupted");
    }
}
