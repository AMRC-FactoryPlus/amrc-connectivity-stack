/*
 * Factory+ metadata database
 * Dataflow update
 * Copyright 2026 University of Sheffield AMRC
 */

package uk.co.amrc.factoryplus.metadb.db;

import io.vavr.control.Option;

import org.apache.jena.rdf.model.*;

public interface Update
{
    public record Config (
            Resource app,
            Resource obj,
            Option<ConfigEntry.Value> value)
        implements Update
    { }

    public class Class implements Update { }
}
